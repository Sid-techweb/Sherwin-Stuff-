import { pool } from '../db/pool';
import { AuthUser, Role } from '../types';
import { pageMeta } from '../utils/pagination';

export async function facilities() {
  return (
    await pool.query(
      `SELECT id, code, name, type, address, city, is_active AS "isActive" FROM facilities ORDER BY name`,
    )
  ).rows;
}

export async function treatmentFacilities() {
  return (
    await pool.query(
      `SELECT id, code, name, address, city, methods::text[] AS methods, capacity_kg_per_day::float AS "capacityKgPerDay",
              is_active AS "isActive" FROM treatment_facilities ORDER BY name`,
    )
  ).rows;
}

export async function vehicles() {
  return (
    await pool.query(
      `SELECT id, registration, type, capacity_kg::float AS "capacityKg", status FROM vehicles ORDER BY registration`,
    )
  ).rows;
}

export async function categories() {
  return (
    await pool.query(
      `SELECT id, code, name, color, description, default_method AS "defaultMethod",
              max_storage_hours AS "maxStorageHours", alert_quantity_kg::float AS "alertQuantityKg"
       FROM waste_categories ORDER BY id`,
    )
  ).rows;
}

/** Used by the UI to pick collectors/transporters. Never returns password hashes. */
export async function users(user: AuthUser, role?: Role) {
  const params: unknown[] = [];
  let where = 'is_active = TRUE';
  if (role) {
    params.push(role);
    where += ` AND role = $${params.length}::user_role`;
  }
  if (user.role === 'HOSPITAL_STAFF') {
    // staff only need assignable field workers, not other staff/admin accounts
    where += ` AND role IN ('WASTE_COLLECTOR','TRANSPORTER')`;
  }
  return (
    await pool.query(
      `SELECT id, name, email, role, facility_id AS "facilityId" FROM users WHERE ${where} ORDER BY name`,
      params,
    )
  ).rows;
}

export interface AuditFilters {
  entity?: string;
  entityId?: string;
  action?: string;
  userId?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

export async function auditLogs(f: AuditFilters) {
  const params: unknown[] = [];
  const where: string[] = ['TRUE'];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.entity) add('a.entity = ?', f.entity);
  if (f.entityId) add('a.entity_id = ?', f.entityId);
  if (f.action) add('a.action = ?', f.action);
  if (f.userId) add('a.user_id = ?', f.userId);
  if (f.from) add('a.created_at >= ?', f.from);
  if (f.to) add('a.created_at <= ?', f.to);
  const W = where.join(' AND ');
  const total = Number((await pool.query(`SELECT count(*) n FROM audit_logs a WHERE ${W}`, params)).rows[0].n);
  const rows = (
    await pool.query(
      `SELECT a.id, a.action, a.entity, a.entity_id AS "entityId", a.metadata, a.created_at AS "createdAt",
              a.user_id AS "userId", u.name AS "userName"
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       WHERE ${W} ORDER BY a.id DESC LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
      params,
    )
  ).rows;
  return { rows, meta: pageMeta(f.page, f.pageSize, total) };
}
