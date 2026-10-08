import { pool, query, withTransaction } from '../db/pool';
import * as repo from '../repositories/workflowRepository';
import * as wasteRepo from '../repositories/wasteRepository';
import { AuthUser } from '../types';
import { AppError, badRequest, notFound } from '../utils/errors';
import { pageMeta } from '../utils/pagination';
import { audit } from './auditService';
import { createAlert, resolveFor } from './alertService';
import { invalidateCaches } from './cacheService';
import { moveStatus } from './wasteService';

export async function list(user: AuthUser, f: { status?: string; delayed?: boolean; page: number; pageSize: number }) {
  const { rows, total } = await repo.listTransports(user, f, pool);
  return { rows, meta: pageMeta(f.page, f.pageSize, total) };
}

export async function get(user: AuthUser, id: string) {
  const t = await repo.getTransport(user, id, pool);
  if (!t) throw notFound('Transport job');
  return t;
}

export async function plan(
  user: AuthUser,
  input: { wasteId: string; vehicleId: string; destinationId: string; expectedArrivalAt: string; transporterId?: string; notes?: string },
) {
  const transporterId = user.role === 'TRANSPORTER' ? user.id : input.transporterId;
  if (!transporterId) throw badRequest('transporterId is required');
  if (new Date(input.expectedArrivalAt).getTime() <= Date.now()) throw badRequest('expectedArrivalAt must be in the future');

  const id = await withTransaction(async (db) => {
    const waste = await wasteRepo.lockStatus(input.wasteId, db);
    if (!waste) throw notFound('Waste record');
    if (waste.status !== 'COLLECTED')
      throw new AppError(409, 'NOT_READY', `Waste must be COLLECTED before transport is planned (currently ${waste.status})`);

    const tr = (await query<{ role: string; is_active: boolean }>('SELECT role, is_active FROM users WHERE id = $1', [transporterId], db)).rows[0];
    if (!tr || tr.role !== 'TRANSPORTER' || !tr.is_active) throw badRequest('transporterId must refer to an active TRANSPORTER user');

    const vehicle = (
      await query<{ status: string; capacity_kg: number }>(
        'SELECT status, capacity_kg::float AS capacity_kg FROM vehicles WHERE id = $1 FOR UPDATE',
        [input.vehicleId],
        db,
      )
    ).rows[0];
    if (!vehicle) throw badRequest('Unknown vehicle');
    if (vehicle.status !== 'AVAILABLE') throw new AppError(409, 'VEHICLE_UNAVAILABLE', `Vehicle is ${vehicle.status}`);
    const kg = waste.unit === 'g' ? waste.quantity / 1000 : waste.quantity;
    if (kg > vehicle.capacity_kg) throw badRequest(`Load of ${kg} kg exceeds vehicle capacity of ${vehicle.capacity_kg} kg`);

    const dest = await repo.treatmentFacility(input.destinationId, db);
    if (!dest || !dest.is_active) throw badRequest('Unknown or inactive destination facility');

    const tid = await repo.insertTransport(
      {
        wasteId: input.wasteId,
        vehicleId: input.vehicleId,
        transporterId,
        originId: waste.facility_id,
        destinationId: input.destinationId,
        expectedArrivalAt: input.expectedArrivalAt,
        notes: input.notes,
      },
      db,
    );
    await repo.setVehicleStatus(input.vehicleId, 'IN_USE', db); // reserved for this job
    await audit(db, user.id, 'VEHICLE_ASSIGNED', 'transport', tid, { vehicleId: input.vehicleId, wasteId: input.wasteId });
    await audit(db, user.id, 'TRANSPORT_PLANNED', 'transport', tid, { wasteId: input.wasteId, destinationId: input.destinationId });
    return tid;
  });
  await invalidateCaches();
  return get(user, id);
}

export async function depart(user: AuthUser, id: string) {
  await withTransaction(async (db) => {
    const t = await repo.getTransport(user, id, db, true);
    if (!t) throw notFound('Transport job');
    if (t.status !== 'PLANNED') throw new AppError(409, 'INVALID_STATE', `Transport is ${t.status}; only PLANNED jobs can depart`);
    await moveStatus(db, t.wasteId, 'IN_TRANSIT', user.id, `Departed in ${t.vehicle}`);
    await repo.startTransport(id, db);
    await audit(db, user.id, 'TRANSPORT_STARTED', 'transport', id, { wasteId: t.wasteId });
  });
  await invalidateCaches();
  return get(user, id);
}

export async function arrive(user: AuthUser, id: string, arrivedAt?: string) {
  if (arrivedAt && new Date(arrivedAt).getTime() > Date.now() + 60_000) throw badRequest('arrivedAt cannot be in the future');
  await withTransaction(async (db) => {
    const t = await repo.getTransport(user, id, db, true);
    if (!t) throw notFound('Transport job');
    if (t.status !== 'IN_TRANSIT') throw new AppError(409, 'INVALID_STATE', `Transport is ${t.status}; only IN_TRANSIT jobs can arrive`);
    if (arrivedAt && new Date(arrivedAt) < new Date(t.departedAt)) throw badRequest('arrivedAt cannot be before departure');

    const res = await repo.finishTransport(id, arrivedAt ?? null, db);
    await moveStatus(db, t.wasteId, 'ARRIVED', user.id, res.is_delayed ? 'Arrived late' : 'Arrived');
    await repo.setVehicleStatus(t.vehicleId, 'AVAILABLE', db);
    await audit(db, user.id, 'TRANSPORT_COMPLETED', 'transport', id, { wasteId: t.wasteId, delayed: res.is_delayed });

    if (res.is_delayed) {
      const minutesLate = Math.round((new Date(res.actual).getTime() - new Date(t.expectedArrivalAt).getTime()) / 60000);
      const wasteRow = await wasteRepo.findById(t.wasteId, db);
      await createAlert(
        db,
        {
          type: 'DELAYED_TRANSPORT',
          severity: minutesLate > 240 ? 'CRITICAL' : minutesLate > 60 ? 'HIGH' : 'MEDIUM',
          message: `Transport of ${t.recordCode} arrived ${minutesLate} min after the expected time`,
          wasteId: t.wasteId,
          facilityId: wasteRow?.facilityId,
        },
        user.id,
      );
    } else {
      await resolveFor(db, t.wasteId, ['DELAYED_TRANSPORT'], user.id);
    }
  });
  await invalidateCaches();
  return get(user, id);
}
