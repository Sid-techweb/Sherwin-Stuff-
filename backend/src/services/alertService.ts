import { Db, pool, query } from '../db/pool';
import { redis, safeRedis } from '../db/redis';
import { AuthUser } from '../types';
import { audit } from './auditService';
import { invalidateCaches } from './cacheService';
import { AppError, notFound } from '../utils/errors';
import { pageMeta } from '../utils/pagination';
import { logger } from '../utils/logger';

export type AlertType =
  | 'DELAYED_COLLECTION'
  | 'DELAYED_TRANSPORT'
  | 'EXCESSIVE_QUANTITY'
  | 'MISSING_DISPOSAL'
  | 'INVALID_TRANSITION'
  | 'VEHICLE_ISSUE'
  | 'UNASSIGNED_WASTE'
  | 'SEGREGATION_PROBLEM';
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

const OPEN_CONFLICT = `ON CONFLICT (type, waste_id) WHERE status <> 'RESOLVED' AND waste_id IS NOT NULL DO NOTHING`;

/** Creates an alert unless an identical open alert (same type + waste) already exists. Returns true if created. */
export async function createAlert(
  db: Db,
  a: { type: AlertType; severity: Severity; message: string; wasteId?: string | null; facilityId?: string | null },
  actorId: string | null = null,
): Promise<boolean> {
  const r = await query<{ id: string }>(
    `INSERT INTO alerts (type, severity, message, waste_id, facility_id)
     VALUES ($1::alert_type, $2::alert_severity, $3, $4, $5) ${OPEN_CONFLICT} RETURNING id`,
    [a.type, a.severity, a.message, a.wasteId ?? null, a.facilityId ?? null],
    db,
  );
  if (r.rows[0]) {
    await audit(db, actorId, 'ALERT_CREATED', 'alert', r.rows[0].id, { type: a.type, severity: a.severity, wasteId: a.wasteId });
    return true;
  }
  return false;
}

/** Auto-resolve open alerts of the given types once the underlying condition is fixed. */
export async function resolveFor(db: Db, wasteId: string, types: AlertType[], actorId: string | null) {
  const r = await query<{ id: string }>(
    `UPDATE alerts SET status = 'RESOLVED', resolved_at = now(), resolved_by = $3
     WHERE waste_id = $1 AND type = ANY($2::alert_type[]) AND status <> 'RESOLVED' RETURNING id`,
    [wasteId, types, actorId],
    db,
  );
  for (const row of r.rows) await audit(db, actorId, 'ALERT_RESOLVED', 'alert', row.id, { auto: true, wasteId });
}

export interface AlertFilters {
  status?: string;
  severity?: string;
  type?: string;
  facilityId?: string;
  page: number;
  pageSize: number;
}

export async function listAlerts(user: AuthUser, f: AlertFilters) {
  const params: unknown[] = [];
  const where: string[] = ['TRUE'];
  const add = (col: string, cast: string, v: unknown) => {
    params.push(v);
    where.push(`a.${col} = $${params.length}${cast}`);
  };
  if (user.role === 'HOSPITAL_STAFF') add('facility_id', '', user.facilityId);
  else if (f.facilityId) add('facility_id', '', f.facilityId);
  if (f.status) add('status', '::alert_status', f.status);
  if (f.severity) add('severity', '::alert_severity', f.severity);
  if (f.type) add('type', '::alert_type', f.type);
  const w = where.join(' AND ');
  const total = Number((await query<{ n: string }>(`SELECT count(*) n FROM alerts a WHERE ${w}`, params)).rows[0].n);
  const rows = (
    await query(
      `SELECT a.id, a.type, a.severity, a.status, a.message, a.created_at AS "createdAt", a.resolved_at AS "resolvedAt",
              a.waste_id AS "wasteId", w.record_code AS "recordCode", a.facility_id AS "facilityId", fa.name AS "facilityName"
       FROM alerts a LEFT JOIN waste_records w ON w.id = a.waste_id LEFT JOIN facilities fa ON fa.id = a.facility_id
       WHERE ${w}
       ORDER BY (a.status = 'RESOLVED'), array_position(ARRAY['CRITICAL','HIGH','MEDIUM','LOW'], a.severity::text), a.created_at DESC
       LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
      params,
    )
  ).rows;
  return { rows, meta: pageMeta(f.page, f.pageSize, total) };
}

export async function createManualAlert(
  user: AuthUser,
  input: { type: AlertType; severity: Severity; message: string; wasteId?: string; facilityId?: string },
) {
  const facilityId = user.role === 'HOSPITAL_STAFF' ? user.facilityId : (input.facilityId ?? null);
  const created = await createAlert(pool, { ...input, facilityId }, user.id);
  if (!created) throw new AppError(409, 'DUPLICATE_ALERT', 'An open alert of this type already exists for this record');
  await invalidateCaches();
}

export async function updateAlertStatus(user: AuthUser, id: string, status: 'ACKNOWLEDGED' | 'RESOLVED') {
  const cur = (await query<{ status: string; facility_id: string | null }>('SELECT status, facility_id FROM alerts WHERE id = $1', [id]))
    .rows[0];
  if (!cur || (user.role === 'HOSPITAL_STAFF' && cur.facility_id !== user.facilityId)) throw notFound('Alert');
  if (cur.status === 'RESOLVED') throw new AppError(409, 'ALREADY_RESOLVED', 'Alert is already resolved');
  await query(
    `UPDATE alerts SET status = $2::alert_status,
       resolved_at = CASE WHEN $2 = 'RESOLVED' THEN now() ELSE resolved_at END,
       resolved_by = CASE WHEN $2 = 'RESOLVED' THEN $3::uuid ELSE resolved_by END
     WHERE id = $1`,
    [id, status, user.id],
  );
  await audit(pool, user.id, status === 'RESOLVED' ? 'ALERT_RESOLVED' : 'ALERT_ACKNOWLEDGED', 'alert', id);
  await invalidateCaches();
}

const SCAN_LOCK = 'alert:scan:lock';
const SCAN_LAST = 'alert:scan:last';

/**
 * Periodic rule scan for time-based problems. Each rule is one set-based INSERT..SELECT;
 * the partial unique index makes it idempotent. A Redis lock stops overlapping scans across instances.
 */
export async function scan(): Promise<{ skipped: boolean; created: Record<string, number> }> {
  const gotLock = await safeRedis(async () => (await redis.set(SCAN_LOCK, '1', 'EX', 60, 'NX')) === 'OK', true);
  if (!gotLock) return { skipped: true, created: {} };

  const rules: Record<string, string> = {
    DELAYED_COLLECTION: `
      INSERT INTO alerts (type, severity, message, waste_id, facility_id)
      SELECT 'DELAYED_COLLECTION'::alert_type,
             CASE WHEN now() - COALESCE(c.scheduled_for, c.requested_at + interval '24 hours') > interval '24 hours'
                  THEN 'HIGH'::alert_severity ELSE 'MEDIUM'::alert_severity END,
             format('Collection for %s is overdue', w.record_code), w.id, w.facility_id
      FROM collection_records c JOIN waste_records w ON w.id = c.waste_id
      WHERE c.status IN ('PENDING','ASSIGNED')
        AND COALESCE(c.scheduled_for, c.requested_at + interval '24 hours') < now()
      ${OPEN_CONFLICT}`,
    DELAYED_TRANSPORT: `
      INSERT INTO alerts (type, severity, message, waste_id, facility_id)
      SELECT 'DELAYED_TRANSPORT'::alert_type, 'HIGH'::alert_severity,
             format('Transport of %s is past its expected arrival time', w.record_code), w.id, w.facility_id
      FROM transport_records t JOIN waste_records w ON w.id = t.waste_id
      WHERE t.status = 'IN_TRANSIT' AND t.expected_arrival_at < now()
      ${OPEN_CONFLICT}`,
    UNASSIGNED_WASTE: `
      INSERT INTO alerts (type, severity, message, waste_id, facility_id)
      SELECT 'UNASSIGNED_WASTE'::alert_type,
             CASE WHEN w.status = 'SEGREGATED' THEN 'HIGH'::alert_severity ELSE 'MEDIUM'::alert_severity END,
             CASE WHEN w.status = 'SEGREGATED'
                  THEN format('%s has exceeded its %s h storage limit without a collection request', w.record_code, cat.max_storage_hours)
                  ELSE format('%s has no collector assigned after 6 hours', w.record_code) END,
             w.id, w.facility_id
      FROM waste_records w JOIN waste_categories cat ON cat.id = w.category_id
      WHERE (w.status = 'SEGREGATED' AND w.generated_at < now() - make_interval(hours => cat.max_storage_hours))
         OR (w.status = 'COLLECTION_PENDING' AND w.updated_at < now() - interval '6 hours'
             AND EXISTS (SELECT 1 FROM collection_records c WHERE c.waste_id = w.id AND c.status = 'PENDING'))
      ${OPEN_CONFLICT}`,
    MISSING_DISPOSAL: `
      INSERT INTO alerts (type, severity, message, waste_id, facility_id)
      SELECT 'MISSING_DISPOSAL'::alert_type, 'HIGH'::alert_severity,
             format('%s arrived at treatment over 24 h ago but has no disposal record', w.record_code), w.id, w.facility_id
      FROM waste_records w
      WHERE w.status IN ('ARRIVED','TREATMENT_PENDING','TREATED') AND w.updated_at < now() - interval '24 hours'
      ${OPEN_CONFLICT}`,
  };

  const created: Record<string, number> = {};
  try {
    for (const [name, sql] of Object.entries(rules)) {
      const r = await pool.query(sql);
      created[name] = r.rowCount ?? 0;
      if (r.rowCount) await audit(pool, null, 'ALERT_SCAN_CREATED', 'alert', null, { rule: name, count: r.rowCount });
    }
  } finally {
    await safeRedis(() => redis.del(SCAN_LOCK), 0);
  }
  if (Object.values(created).some((n) => n > 0)) await invalidateCaches();
  await safeRedis(() => redis.set(SCAN_LAST, JSON.stringify({ at: new Date().toISOString(), created }), 'EX', 86400), null);
  logger.info({ created }, 'alert scan complete');
  return { skipped: false, created };
}

export async function lastScan() {
  const v = await safeRedis(() => redis.get(SCAN_LAST), null);
  return v ? JSON.parse(v) : null;
}
