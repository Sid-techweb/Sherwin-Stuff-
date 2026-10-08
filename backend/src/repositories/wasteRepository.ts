import { Db, query } from '../db/pool';
import { AuthUser } from '../types';
import { WasteStatus } from '../services/lifecycle';
import { wasteVisibility } from './visibility';

const SELECT = `
  SELECT w.id, w.record_code AS "recordCode", w.status, w.quantity::float AS quantity, w.unit,
         w.generated_at AS "generatedAt", w.notes, w.is_demo AS "isDemo",
         w.created_at AS "createdAt", w.updated_at AS "updatedAt", w.closed_at AS "closedAt",
         c.id AS "categoryId", c.code AS "categoryCode", c.name AS "categoryName",
         f.id AS "facilityId", f.name AS "facilityName", u.name AS "createdByName"
  FROM waste_records w
  JOIN waste_categories c ON c.id = w.category_id
  JOIN facilities f ON f.id = w.facility_id
  JOIN users u ON u.id = w.created_by`;

// Whitelist: user-supplied sort keys are mapped to fixed column names, never interpolated.
const SORT_COLUMNS: Record<string, string> = {
  generatedAt: 'w.generated_at',
  createdAt: 'w.created_at',
  quantity: 'w.quantity',
  status: 'w.status',
  recordCode: 'w.record_code',
};

export interface WasteListFilters {
  search?: string;
  status?: WasteStatus;
  categoryId?: number;
  facilityId?: string;
  from?: string;
  to?: string;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export async function list(user: AuthUser, f: WasteListFilters, db: Db) {
  const params: unknown[] = [];
  const where: string[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  const vis = wasteVisibility(user, 1);
  params.push(...vis.params);
  where.push(vis.sql);
  if (f.status) add('w.status = ?', f.status);
  if (f.categoryId) add('w.category_id = ?', f.categoryId);
  if (f.facilityId) add('w.facility_id = ?', f.facilityId);
  if (f.from) add('w.generated_at >= ?', f.from);
  if (f.to) add('w.generated_at <= ?', f.to);
  if (f.search) {
    params.push(`%${f.search}%`);
    where.push(`(w.record_code ILIKE $${params.length} OR w.notes ILIKE $${params.length})`);
  }
  const whereSql = where.join(' AND ');
  const sortCol = SORT_COLUMNS[f.sortBy] ?? SORT_COLUMNS.generatedAt;
  const dir = f.sortDir === 'asc' ? 'ASC' : 'DESC';

  const total = (await query<{ n: string }>(`SELECT count(*) AS n FROM waste_records w WHERE ${whereSql}`, params, db))
    .rows[0].n;
  const rows = (
    await query(
      `${SELECT} WHERE ${whereSql} ORDER BY ${sortCol} ${dir}, w.id LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
      params,
      db,
    )
  ).rows;
  return { rows, total: Number(total) };
}

export async function findById(id: string, db: Db) {
  return (await query(`${SELECT} WHERE w.id = $1`, [id], db)).rows[0] ?? null;
}

/** Locks the row for the rest of the transaction so concurrent transitions serialise. */
export async function lockStatus(id: string, db: Db) {
  const r = await query<{ status: WasteStatus; facility_id: string; category_id: number; quantity: number; unit: string }>(
    'SELECT status, facility_id, category_id, quantity::float AS quantity, unit FROM waste_records WHERE id = $1 FOR UPDATE',
    [id],
    db,
  );
  return r.rows[0] ?? null;
}

export async function insert(
  input: {
    categoryId: number;
    facilityId: string;
    quantity: number;
    unit: string;
    generatedAt?: string;
    notes?: string;
    createdBy: string;
  },
  db: Db,
) {
  const r = await query<{ id: string }>(
    `INSERT INTO waste_records (category_id, facility_id, quantity, unit, generated_at, notes, created_by)
     VALUES ($1,$2,$3,$4,COALESCE($5::timestamptz, now()),$6,$7) RETURNING id`,
    [input.categoryId, input.facilityId, input.quantity, input.unit, input.generatedAt ?? null, input.notes ?? null, input.createdBy],
    db,
  );
  return r.rows[0].id;
}

export async function update(
  id: string,
  patch: { categoryId?: number; quantity?: number; unit?: string; notes?: string | null },
  db: Db,
) {
  await query(
    `UPDATE waste_records SET
       category_id = COALESCE($2, category_id),
       quantity    = COALESCE($3, quantity),
       unit        = COALESCE($4, unit),
       notes       = CASE WHEN $5::boolean THEN $6 ELSE notes END,
       updated_at  = now()
     WHERE id = $1`,
    [id, patch.categoryId ?? null, patch.quantity ?? null, patch.unit ?? null, patch.notes !== undefined, patch.notes ?? null],
    db,
  );
}

export async function setStatus(id: string, status: WasteStatus, db: Db) {
  await query(
    `UPDATE waste_records SET status = $2::waste_status, updated_at = now(),
       closed_at = CASE WHEN $2::waste_status IN ('CLOSED','REJECTED') THEN now() ELSE closed_at END
     WHERE id = $1`,
    [id, status],
    db,
  );
}

export async function remove(id: string, db: Db) {
  await query('DELETE FROM waste_records WHERE id = $1', [id], db);
}

export async function addHistory(
  wasteId: string,
  from: WasteStatus | null,
  to: WasteStatus,
  userId: string | null,
  note: string | null,
  db: Db,
) {
  await query(
    'INSERT INTO waste_status_history (waste_id, from_status, to_status, changed_by, note) VALUES ($1,$2,$3,$4,$5)',
    [wasteId, from, to, userId, note],
    db,
  );
}

export async function getHistory(wasteId: string, db: Db) {
  return (
    await query(
      `SELECT h.id, h.from_status AS "fromStatus", h.to_status AS "toStatus", h.note, h.changed_at AS "changedAt",
              u.name AS "changedByName"
       FROM waste_status_history h LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.waste_id = $1 ORDER BY h.changed_at, h.id`,
      [wasteId],
      db,
    )
  ).rows;
}

export async function getCategory(id: number, db: Db) {
  return (
    await query<{ id: number; code: string; alert_quantity_kg: number; name: string }>(
      'SELECT id, code, name, alert_quantity_kg::float AS alert_quantity_kg FROM waste_categories WHERE id = $1',
      [id],
      db,
    )
  ).rows[0] ?? null;
}

/** Fetch one record only if the user is allowed to see it (otherwise null -> 404, not 403, to avoid leaking existence). */
export async function findVisible(user: AuthUser, id: string, db: Db) {
  const vis = wasteVisibility(user, 2);
  return (await query(`${SELECT} WHERE w.id = $1 AND ${vis.sql}`, [id, ...vis.params], db)).rows[0] ?? null;
}
