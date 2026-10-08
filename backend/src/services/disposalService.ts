import { pool, withTransaction } from '../db/pool';
import * as repo from '../repositories/workflowRepository';
import * as wasteRepo from '../repositories/wasteRepository';
import { AuthUser } from '../types';
import { badRequest, notFound } from '../utils/errors';
import { pageMeta } from '../utils/pagination';
import { audit } from './auditService';
import { resolveFor } from './alertService';
import { invalidateCaches } from './cacheService';
import { moveStatus } from './wasteService';

export async function list(user: AuthUser, f: { page: number; pageSize: number }) {
  const { rows, total } = await repo.listDisposals(user, f, pool);
  return { rows, meta: pageMeta(f.page, f.pageSize, total) };
}

/**
 * Records treatment + disposal in one transaction, walking the state machine
 * (ARRIVED -> TREATMENT_PENDING ->) TREATED -> DISPOSED so every step lands in the history.
 */
export async function record(
  user: AuthUser,
  input: {
    wasteId: string;
    method: string;
    treatmentFacilityId?: string;
    treatedAt?: string;
    disposedAt?: string;
    certificateNo?: string;
    notes?: string;
  },
) {
  const now = new Date();
  const treatedAt = input.treatedAt ?? now.toISOString();
  const disposedAt = input.disposedAt ?? now.toISOString();
  if (new Date(treatedAt) > new Date(now.getTime() + 60_000) || new Date(disposedAt) > new Date(now.getTime() + 60_000))
    throw badRequest('Treatment and disposal times cannot be in the future');
  if (new Date(disposedAt) < new Date(treatedAt)) throw badRequest('disposedAt cannot be before treatedAt');

  const id = await withTransaction(async (db) => {
    const waste = await wasteRepo.lockStatus(input.wasteId, db);
    if (!waste) throw notFound('Waste record');

    const facilityId = input.treatmentFacilityId ?? (await repo.activeTransportFor(input.wasteId, db))?.destination_id;
    if (!facilityId) throw badRequest('treatmentFacilityId is required (no completed transport found)');
    const facility = await repo.treatmentFacility(facilityId, db);
    if (!facility || !facility.is_active) throw badRequest('Unknown or inactive treatment facility');
    if (!facility.methods.includes(input.method)) throw badRequest(`${facility.name} does not support ${input.method}`);

    if (waste.status === 'ARRIVED') await moveStatus(db, input.wasteId, 'TREATMENT_PENDING', user.id, 'Queued for treatment');
    await moveStatus(db, input.wasteId, 'TREATED', user.id, `Treated by ${input.method}`);
    await moveStatus(db, input.wasteId, 'DISPOSED', user.id, 'Disposed');

    const did = await repo.insertDisposal(
      { ...input, facilityId, operatorId: user.id, treatedAt, disposedAt },
      db,
    );
    await audit(db, user.id, 'DISPOSAL_RECORDED', 'disposal', did, { wasteId: input.wasteId, method: input.method, facilityId });
    await resolveFor(db, input.wasteId, ['MISSING_DISPOSAL'], user.id);
    return did;
  });
  await invalidateCaches();
  return { id };
}
