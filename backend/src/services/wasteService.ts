import { PoolClient } from 'pg';
import { Db, pool, withTransaction } from '../db/pool';
import * as repo from '../repositories/wasteRepository';
import { AuthUser } from '../types';
import { AppError, badRequest, forbidden, notFound } from '../utils/errors';
import { pageMeta } from '../utils/pagination';
import { audit } from './auditService';
import { createAlert, resolveFor } from './alertService';
import { invalidateCaches } from './cacheService';
import { assertTransition, WasteStatus } from './lifecycle';

const toKg = (q: number, unit: string) => (unit === 'g' ? q / 1000 : q);

/**
 * The ONE place that changes a waste record's status.
 * Locks the row, validates the move against the state machine, updates, and writes history + audit.
 * Must be called inside a transaction (pass the client).
 */
export async function moveStatus(
  db: PoolClient,
  wasteId: string,
  to: WasteStatus,
  userId: string | null,
  note: string | null = null,
): Promise<WasteStatus> {
  const cur = await repo.lockStatus(wasteId, db);
  if (!cur) throw notFound('Waste record');
  assertTransition(cur.status, to);
  await repo.setStatus(wasteId, to, db);
  await repo.addHistory(wasteId, cur.status, to, userId, note, db);
  await audit(db, userId, 'WASTE_STATUS_CHANGED', 'waste_record', wasteId, { from: cur.status, to, note });
  return cur.status;
}

function assertFacilityAccess(user: AuthUser, facilityId: string) {
  if (user.role === 'HOSPITAL_STAFF' && user.facilityId !== facilityId) throw forbidden('Record belongs to another facility');
}

export async function list(user: AuthUser, filters: repo.WasteListFilters) {
  const { rows, total } = await repo.list(user, filters, pool);
  return { rows, meta: pageMeta(filters.page, filters.pageSize, total) };
}

export async function getDetail(user: AuthUser, id: string) {
  const record = await repo.findVisible(user, id, pool);
  if (!record) throw notFound('Waste record');
  const history = await repo.getHistory(id, pool);
  const { rows: collections } = await pool.query(
    `SELECT c.id, c.status, c.requested_at AS "requestedAt", c.scheduled_for AS "scheduledFor", c.collected_at AS "collectedAt",
            c.collected_quantity::float AS "collectedQuantity", u.name AS "collectorName"
     FROM collection_records c LEFT JOIN users u ON u.id = c.collector_id WHERE c.waste_id = $1 ORDER BY c.requested_at`,
    [id],
  );
  const { rows: transports } = await pool.query(
    `SELECT t.id, t.status, t.departed_at AS "departedAt", t.expected_arrival_at AS "expectedArrivalAt",
            t.actual_arrival_at AS "actualArrivalAt", t.is_delayed AS "isDelayed",
            v.registration AS "vehicle", tf.name AS "destination", u.name AS "transporterName"
     FROM transport_records t JOIN vehicles v ON v.id = t.vehicle_id JOIN treatment_facilities tf ON tf.id = t.destination_id
     JOIN users u ON u.id = t.transporter_id WHERE t.waste_id = $1 ORDER BY t.created_at`,
    [id],
  );
  const { rows: disposals } = await pool.query(
    `SELECT d.id, d.method, d.treated_at AS "treatedAt", d.disposed_at AS "disposedAt", d.certificate_no AS "certificateNo",
            tf.name AS "treatmentFacility", u.name AS "operatorName"
     FROM disposal_records d JOIN treatment_facilities tf ON tf.id = d.treatment_facility_id JOIN users u ON u.id = d.operator_id
     WHERE d.waste_id = $1`,
    [id],
  );
  const { rows: auditTrail } = await pool.query(
    `SELECT a.id, a.action, a.metadata, a.created_at AS "createdAt", u.name AS "userName"
     FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.entity = 'waste_record' AND a.entity_id = $1 ORDER BY a.id`,
    [id],
  );
  return { ...record, history, collections, transports, disposals, auditTrail };
}

export async function create(
  user: AuthUser,
  input: { categoryId: number; facilityId?: string; quantity: number; unit: 'kg' | 'g' | 'l'; generatedAt?: string; notes?: string },
) {
  const facilityId = user.role === 'HOSPITAL_STAFF' ? user.facilityId : input.facilityId;
  if (!facilityId) throw badRequest('facilityId is required');
  if (input.generatedAt && new Date(input.generatedAt).getTime() > Date.now() + 5 * 60_000)
    throw badRequest('generatedAt cannot be in the future');

  const id = await withTransaction(async (db) => {
    const cat = await repo.getCategory(input.categoryId, db);
    if (!cat) throw badRequest('Unknown waste category');
    const newId = await repo.insert({ ...input, facilityId, createdBy: user.id }, db);
    await repo.addHistory(newId, null, 'SEGREGATED', user.id, 'Record created', db);
    await audit(db, user.id, 'WASTE_CREATED', 'waste_record', newId, {
      category: cat.code,
      quantity: input.quantity,
      unit: input.unit,
      facilityId,
    });
    const kg = toKg(input.quantity, input.unit);
    if (kg > cat.alert_quantity_kg) {
      await createAlert(
        db,
        {
          type: 'EXCESSIVE_QUANTITY',
          severity: kg > cat.alert_quantity_kg * 2 ? 'HIGH' : 'MEDIUM',
          message: `${kg} kg of ${cat.name} recorded, above the ${cat.alert_quantity_kg} kg threshold`,
          wasteId: newId,
          facilityId,
        },
        user.id,
      );
    }
    return newId;
  });
  await invalidateCaches();
  return getDetail(user, id);
}

export async function update(
  user: AuthUser,
  id: string,
  patch: { categoryId?: number; quantity?: number; unit?: 'kg' | 'g' | 'l'; notes?: string | null },
) {
  await withTransaction(async (db) => {
    const cur = await repo.lockStatus(id, db);
    if (!cur) throw notFound('Waste record');
    assertFacilityAccess(user, cur.facility_id);
    if (!['SEGREGATED', 'COLLECTION_PENDING'].includes(cur.status))
      throw new AppError(409, 'NOT_EDITABLE', `Records in status ${cur.status} can no longer be edited`);
    if (patch.categoryId && !(await repo.getCategory(patch.categoryId, db))) throw badRequest('Unknown waste category');
    await repo.update(id, patch, db);
    await audit(db, user.id, 'WASTE_UPDATED', 'waste_record', id, { changes: patch });
  });
  await invalidateCaches();
  return getDetail(user, id);
}

export async function remove(user: AuthUser, id: string) {
  await withTransaction(async (db) => {
    const cur = await repo.lockStatus(id, db);
    if (!cur) throw notFound('Waste record');
    if (cur.status !== 'SEGREGATED')
      throw new AppError(409, 'NOT_DELETABLE', 'Only records that have not entered the workflow can be deleted; reject instead');
    await repo.remove(id, db);
    await audit(db, user.id, 'WASTE_DELETED', 'waste_record', id, {});
  });
  await invalidateCaches();
}

/** Targets reachable through the generic endpoint; the rest are driven by collection/transport/disposal workflows. */
const MANUAL_TARGETS: Partial<Record<WasteStatus, string[]>> = {
  TREATMENT_PENDING: ['ADMIN', 'TREATMENT_OPERATOR'],
  CLOSED: ['ADMIN', 'TREATMENT_OPERATOR', 'HOSPITAL_STAFF'],
  REJECTED: ['ADMIN', 'TREATMENT_OPERATOR', 'HOSPITAL_STAFF'],
};

export async function transition(user: AuthUser, id: string, to: WasteStatus, note?: string) {
  const visible = await repo.findVisible(user, id, pool);
  if (!visible) throw notFound('Waste record');
  const allowedRoles = MANUAL_TARGETS[to];
  if (!allowedRoles) throw badRequest(`Status ${to} is set automatically by the collection, transport or disposal workflow`);
  if (!allowedRoles.includes(user.role)) throw forbidden();
  try {
    await withTransaction(async (db) => {
      await moveStatus(db, id, to, user.id, note ?? null);
      if (to === 'REJECTED') {
        // a rejected record leaves the workflow: its open alerts no longer apply
        await resolveFor(db, id, ['DELAYED_COLLECTION', 'UNASSIGNED_WASTE', 'MISSING_DISPOSAL'], user.id);
        await db.query(
          `UPDATE collection_records SET status = 'CANCELLED' WHERE waste_id = $1 AND status IN ('PENDING','ASSIGNED')`,
          [id],
        );
        await db.query(
          `UPDATE vehicles SET status = 'AVAILABLE'
           WHERE id IN (SELECT vehicle_id FROM transport_records WHERE waste_id = $1 AND status = 'PLANNED')`,
          [id],
        );
        await db.query(`UPDATE transport_records SET status = 'CANCELLED' WHERE waste_id = $1 AND status = 'PLANNED'`, [id]);
      }
    });
  } catch (err) {
    if (err instanceof AppError && err.code === 'INVALID_TRANSITION') {
      // Record the attempted illegal move as an alert (outside the rolled-back transaction).
      await createAlert(
        pool,
        {
          type: 'INVALID_TRANSITION',
          severity: 'LOW',
          message: `Rejected attempt to move ${visible.recordCode} from ${visible.status} to ${to}`,
          wasteId: id,
          facilityId: visible.facilityId,
        },
        user.id,
      );
      await audit(pool, user.id, 'INVALID_TRANSITION_ATTEMPT', 'waste_record', id, { from: visible.status, to });
      await invalidateCaches();
    }
    throw err;
  }
  await invalidateCaches();
  return getDetail(user, id);
}

export type { Db };
