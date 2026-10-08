import { pool, query, withTransaction } from '../db/pool';
import * as repo from '../repositories/workflowRepository';
import * as wasteRepo from '../repositories/wasteRepository';
import { AuthUser } from '../types';
import { AppError, badRequest, forbidden, notFound } from '../utils/errors';
import { pageMeta } from '../utils/pagination';
import { audit } from './auditService';
import { resolveFor } from './alertService';
import { invalidateCaches } from './cacheService';
import { moveStatus } from './wasteService';

export async function list(user: AuthUser, f: { status?: string; page: number; pageSize: number }) {
  const { rows, total } = await repo.listCollections(user, f, pool);
  return { rows, meta: pageMeta(f.page, f.pageSize, total) };
}

export async function get(user: AuthUser, id: string) {
  const c = await repo.getCollection(user, id, pool);
  if (!c) throw notFound('Collection');
  return c;
}

export async function request(user: AuthUser, input: { wasteId: string; scheduledFor?: string; notes?: string }) {
  const id = await withTransaction(async (db) => {
    const waste = await wasteRepo.lockStatus(input.wasteId, db);
    if (!waste) throw notFound('Waste record');
    if (user.role === 'HOSPITAL_STAFF' && waste.facility_id !== user.facilityId) throw forbidden('Record belongs to another facility');
    await moveStatus(db, input.wasteId, 'COLLECTION_PENDING', user.id, 'Collection requested');
    const cid = await repo.insertCollection({ ...input, requestedBy: user.id }, db);
    await audit(db, user.id, 'COLLECTION_REQUESTED', 'collection', cid, { wasteId: input.wasteId, scheduledFor: input.scheduledFor });
    return cid;
  });
  await invalidateCaches();
  return get(user, id);
}

export async function assign(user: AuthUser, id: string, collectorId: string) {
  await withTransaction(async (db) => {
    const c = await repo.getCollection(user, id, db, true);
    if (!c) throw notFound('Collection');
    if (!['PENDING', 'ASSIGNED'].includes(c.status))
      throw new AppError(409, 'INVALID_STATE', `Collection is ${c.status}; collector can no longer be changed`);
    const collector = (
      await query<{ role: string; is_active: boolean }>('SELECT role, is_active FROM users WHERE id = $1', [collectorId], db)
    ).rows[0];
    if (!collector || collector.role !== 'WASTE_COLLECTOR' || !collector.is_active)
      throw badRequest('collectorId must refer to an active WASTE_COLLECTOR user');
    await repo.assignCollector(id, collectorId, db);
    await audit(db, user.id, 'COLLECTION_ASSIGNED', 'collection', id, { collectorId, wasteId: c.wasteId });
  });
  await invalidateCaches();
  return get(user, id);
}

export async function complete(user: AuthUser, id: string, collectedQuantity?: number) {
  await withTransaction(async (db) => {
    const c = await repo.getCollection(user, id, db, true);
    if (!c) throw notFound('Collection');
    if (c.status !== 'ASSIGNED')
      throw new AppError(409, 'INVALID_STATE', c.status === 'PENDING' ? 'Assign a collector before completing' : `Collection is already ${c.status}`);
    await moveStatus(db, c.wasteId, 'COLLECTED', user.id, 'Collected');
    await repo.completeCollection(id, collectedQuantity ?? null, db);
    await audit(db, user.id, 'COLLECTION_COMPLETED', 'collection', id, { wasteId: c.wasteId, collectedQuantity });
    await resolveFor(db, c.wasteId, ['DELAYED_COLLECTION', 'UNASSIGNED_WASTE'], user.id);
  });
  await invalidateCaches();
  return get(user, id);
}
