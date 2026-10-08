import { pool } from '../db/pool';
import { config } from '../config';
import { AuthUser } from '../types';
import { cached } from './cacheService';

export interface DashboardFilters {
  from?: string;
  to?: string;
  facilityId?: string;
  categoryId?: number;
  status?: string;
}

const KG = `(CASE w.unit WHEN 'g' THEN w.quantity / 1000.0 ELSE w.quantity END)`;

async function compute(facilityScope: string | undefined, f: DashboardFilters) {
  const params: unknown[] = [];
  const where: string[] = ['TRUE'];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (facilityScope) add('w.facility_id = ?', facilityScope);
  else if (f.facilityId) add('w.facility_id = ?', f.facilityId);
  if (f.categoryId) add('w.category_id = ?', f.categoryId);
  if (f.status) add('w.status = ?::waste_status', f.status);
  if (f.from) add('w.generated_at >= ?', f.from);
  if (f.to) add('w.generated_at <= ?', f.to);
  const W = where.join(' AND ');
  const q = async (sql: string) => (await pool.query(sql, params)).rows;

  const [byStatus, byCategory, overTime, byFacility, methods, ops] = await Promise.all([
    q(`SELECT w.status, count(*)::int AS records, round(sum(${KG}), 2)::float AS "quantityKg"
       FROM waste_records w WHERE ${W} GROUP BY w.status`),
    q(`SELECT c.code, c.name, c.color, count(*)::int AS records, round(sum(${KG}), 2)::float AS "quantityKg"
       FROM waste_records w JOIN waste_categories c ON c.id = w.category_id WHERE ${W}
       GROUP BY c.id ORDER BY "quantityKg" DESC`),
    q(`SELECT to_char(date_trunc('day', w.generated_at), 'YYYY-MM-DD') AS day, count(*)::int AS records,
              round(sum(${KG}), 2)::float AS "quantityKg"
       FROM waste_records w WHERE ${W} GROUP BY 1 ORDER BY 1`),
    q(`SELECT fa.id, fa.name, count(DISTINCT w.id)::int AS records, round(sum(${KG}), 2)::float AS "quantityKg",
              count(DISTINCT w.id) FILTER (WHERE w.status IN ('DISPOSED','CLOSED'))::int AS disposed,
              count(DISTINCT t.id) FILTER (WHERE t.is_delayed)::int AS "delayedTransports"
       FROM waste_records w JOIN facilities fa ON fa.id = w.facility_id
       LEFT JOIN transport_records t ON t.waste_id = w.id
       WHERE ${W} GROUP BY fa.id ORDER BY "quantityKg" DESC`),
    q(`SELECT d.method, count(*)::int AS records FROM disposal_records d JOIN waste_records w ON w.id = d.waste_id
       WHERE ${W} GROUP BY d.method ORDER BY records DESC`),
    q(`SELECT
         (SELECT count(*) FROM collection_records c JOIN waste_records w ON w.id = c.waste_id
            WHERE c.status IN ('PENDING','ASSIGNED') AND ${W})::int AS "pendingCollections",
         (SELECT count(*) FROM transport_records t JOIN waste_records w ON w.id = t.waste_id
            WHERE (t.is_delayed OR (t.status = 'IN_TRANSIT' AND t.expected_arrival_at < now())) AND ${W})::int AS "delayedTransports",
         (SELECT count(*) FROM alerts a JOIN waste_records w ON w.id = a.waste_id
            WHERE a.status <> 'RESOLVED' AND ${W})::int AS "activeAlerts"`),
  ]);

  const st = (...names: string[]) => byStatus.filter((r) => names.includes(r.status)).reduce((s, r) => s + r.records, 0);
  const totalKg = byStatus.reduce((s, r) => s + (r.quantityKg ?? 0), 0);
  return {
    totals: {
      records: byStatus.reduce((s, r) => s + r.records, 0),
      quantityKg: Math.round(totalKg * 100) / 100,
      collected: st('COLLECTED'),
      inTransit: st('IN_TRANSIT'),
      awaitingDisposal: st('ARRIVED', 'TREATMENT_PENDING', 'TREATED'),
      disposed: st('DISPOSED', 'CLOSED'),
      ...ops[0],
    },
    byStatus,
    byCategory,
    overTime,
    byFacility,
    disposalMethods: methods,
    generatedAt: new Date().toISOString(),
  };
}

export async function dashboard(user: AuthUser, filters: DashboardFilters) {
  const scope = user.role === 'HOSPITAL_STAFF' ? (user.facilityId ?? undefined) : undefined;
  return cached('dash', { scope, filters }, config.dashboardCacheTtl, () => compute(scope, filters));
}
