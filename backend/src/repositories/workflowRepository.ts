import { Db, query } from '../db/pool';
import { AuthUser } from '../types';

// ---------- collections ----------
const COLLECTION_SELECT = `
  SELECT c.id, c.status, c.requested_at AS "requestedAt", c.scheduled_for AS "scheduledFor",
         c.collected_at AS "collectedAt", c.collected_quantity::float AS "collectedQuantity", c.notes,
         c.waste_id AS "wasteId", w.record_code AS "recordCode", w.quantity::float AS quantity, w.unit,
         w.facility_id AS "facilityId", f.name AS "facilityName",
         c.collector_id AS "collectorId", col.name AS "collectorName", rq.name AS "requestedByName"
  FROM collection_records c
  JOIN waste_records w ON w.id = c.waste_id
  JOIN facilities f ON f.id = w.facility_id
  JOIN users rq ON rq.id = c.requested_by
  LEFT JOIN users col ON col.id = c.collector_id`;

function collectionScope(user: AuthUser, startIdx: number): { sql: string; params: unknown[] } {
  if (user.role === 'HOSPITAL_STAFF') return { sql: `w.facility_id = $${startIdx}`, params: [user.facilityId] };
  if (user.role === 'WASTE_COLLECTOR') return { sql: `c.collector_id = $${startIdx}`, params: [user.id] };
  return { sql: 'TRUE', params: [] };
}

export async function listCollections(
  user: AuthUser,
  f: { status?: string; page: number; pageSize: number },
  db: Db,
) {
  const scope = collectionScope(user, 1);
  const params = [...scope.params];
  let where = scope.sql;
  if (f.status) {
    params.push(f.status);
    where += ` AND c.status = $${params.length}::collection_status`;
  }
  const total = Number(
    (await query<{ n: string }>(`SELECT count(*) n FROM collection_records c JOIN waste_records w ON w.id=c.waste_id WHERE ${where}`, params, db))
      .rows[0].n,
  );
  const rows = (
    await query(
      `${COLLECTION_SELECT} WHERE ${where} ORDER BY c.requested_at DESC LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
      params,
      db,
    )
  ).rows;
  return { rows, total };
}

export async function getCollection(user: AuthUser, id: string, db: Db, lock = false) {
  const scope = collectionScope(user, 2);
  const r = await query(
    `${COLLECTION_SELECT} WHERE c.id = $1 AND ${scope.sql}${lock ? ' FOR UPDATE OF c' : ''}`,
    [id, ...scope.params],
    db,
  );
  return r.rows[0] ?? null;
}

export async function insertCollection(
  i: { wasteId: string; requestedBy: string; scheduledFor?: string; notes?: string },
  db: Db,
) {
  const r = await query<{ id: string }>(
    `INSERT INTO collection_records (waste_id, requested_by, scheduled_for, notes) VALUES ($1,$2,$3,$4) RETURNING id`,
    [i.wasteId, i.requestedBy, i.scheduledFor ?? null, i.notes ?? null],
    db,
  );
  return r.rows[0].id;
}

export async function assignCollector(id: string, collectorId: string, db: Db) {
  await query(`UPDATE collection_records SET collector_id = $2, status = 'ASSIGNED' WHERE id = $1`, [id, collectorId], db);
}

export async function completeCollection(id: string, quantity: number | null, db: Db) {
  await query(
    `UPDATE collection_records SET status = 'COMPLETED', collected_at = now(),
       collected_quantity = COALESCE($2, (SELECT quantity FROM waste_records WHERE id = waste_id))
     WHERE id = $1`,
    [id, quantity],
    db,
  );
}

// ---------- transport ----------
const TRANSPORT_SELECT = `
  SELECT t.id, t.status, t.departed_at AS "departedAt", t.expected_arrival_at AS "expectedArrivalAt",
         t.actual_arrival_at AS "actualArrivalAt", t.is_delayed AS "isDelayed", t.notes,
         t.waste_id AS "wasteId", w.record_code AS "recordCode", w.quantity::float AS quantity, w.unit,
         t.vehicle_id AS "vehicleId", v.registration AS vehicle,
         t.transporter_id AS "transporterId", u.name AS "transporterName",
         t.origin_facility_id AS "originId", o.name AS origin,
         t.destination_id AS "destinationId", d.name AS destination
  FROM transport_records t
  JOIN waste_records w ON w.id = t.waste_id
  JOIN vehicles v ON v.id = t.vehicle_id
  JOIN users u ON u.id = t.transporter_id
  JOIN facilities o ON o.id = t.origin_facility_id
  JOIN treatment_facilities d ON d.id = t.destination_id`;

function transportScope(user: AuthUser, startIdx: number): { sql: string; params: unknown[] } {
  if (user.role === 'HOSPITAL_STAFF') return { sql: `t.origin_facility_id = $${startIdx}`, params: [user.facilityId] };
  if (user.role === 'TRANSPORTER') return { sql: `t.transporter_id = $${startIdx}`, params: [user.id] };
  return { sql: 'TRUE', params: [] };
}

export async function listTransports(user: AuthUser, f: { status?: string; delayed?: boolean; page: number; pageSize: number }, db: Db) {
  const scope = transportScope(user, 1);
  const params = [...scope.params];
  let where = scope.sql;
  if (f.status) {
    params.push(f.status);
    where += ` AND t.status = $${params.length}::transport_status`;
  }
  if (f.delayed)
    where += ` AND (t.is_delayed OR (t.status = 'IN_TRANSIT' AND t.expected_arrival_at < now()))`;
  const total = Number((await query<{ n: string }>(`SELECT count(*) n FROM transport_records t WHERE ${where}`, params, db)).rows[0].n);
  const rows = (
    await query(
      `${TRANSPORT_SELECT} WHERE ${where} ORDER BY t.created_at DESC LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
      params,
      db,
    )
  ).rows;
  return { rows, total };
}

export async function getTransport(user: AuthUser, id: string, db: Db, lock = false) {
  const scope = transportScope(user, 2);
  const r = await query(
    `${TRANSPORT_SELECT} WHERE t.id = $1 AND ${scope.sql}${lock ? ' FOR UPDATE OF t' : ''}`,
    [id, ...scope.params],
    db,
  );
  return r.rows[0] ?? null;
}

export async function insertTransport(
  i: {
    wasteId: string;
    vehicleId: string;
    transporterId: string;
    originId: string;
    destinationId: string;
    expectedArrivalAt: string;
    notes?: string;
  },
  db: Db,
) {
  const r = await query<{ id: string }>(
    `INSERT INTO transport_records (waste_id, vehicle_id, transporter_id, origin_facility_id, destination_id, expected_arrival_at, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [i.wasteId, i.vehicleId, i.transporterId, i.originId, i.destinationId, i.expectedArrivalAt, i.notes ?? null],
    db,
  );
  return r.rows[0].id;
}

export async function startTransport(id: string, db: Db) {
  await query(`UPDATE transport_records SET status = 'IN_TRANSIT', departed_at = now() WHERE id = $1`, [id], db);
}

export async function finishTransport(id: string, arrivedAt: string | null, db: Db) {
  const r = await query<{ is_delayed: boolean; actual: Date }>(
    `UPDATE transport_records SET status = 'ARRIVED',
       actual_arrival_at = COALESCE($2::timestamptz, now()),
       is_delayed = COALESCE($2::timestamptz, now()) > expected_arrival_at
     WHERE id = $1 RETURNING is_delayed, actual_arrival_at AS actual`,
    [id, arrivedAt],
    db,
  );
  return r.rows[0];
}

export async function setVehicleStatus(id: string, status: 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE', db: Db) {
  await query('UPDATE vehicles SET status = $2 WHERE id = $1', [id, status], db);
}

// ---------- disposal ----------
export async function listDisposals(user: AuthUser, f: { page: number; pageSize: number }, db: Db) {
  const scope = user.role === 'HOSPITAL_STAFF' ? { sql: 'w.facility_id = $1', params: [user.facilityId] } : { sql: 'TRUE', params: [] };
  const total = Number(
    (await query<{ n: string }>(`SELECT count(*) n FROM disposal_records d JOIN waste_records w ON w.id=d.waste_id WHERE ${scope.sql}`, scope.params, db))
      .rows[0].n,
  );
  const rows = (
    await query(
      `SELECT d.id, d.method, d.treated_at AS "treatedAt", d.disposed_at AS "disposedAt", d.certificate_no AS "certificateNo", d.notes,
              d.waste_id AS "wasteId", w.record_code AS "recordCode", w.quantity::float AS quantity, w.unit,
              tf.name AS "treatmentFacility", u.name AS "operatorName", w.facility_id AS "facilityId"
       FROM disposal_records d JOIN waste_records w ON w.id = d.waste_id
       JOIN treatment_facilities tf ON tf.id = d.treatment_facility_id JOIN users u ON u.id = d.operator_id
       WHERE ${scope.sql} ORDER BY d.disposed_at DESC LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
      scope.params,
      db,
    )
  ).rows;
  return { rows, total };
}

export async function insertDisposal(
  i: {
    wasteId: string;
    facilityId: string;
    operatorId: string;
    method: string;
    treatedAt: string;
    disposedAt: string;
    certificateNo?: string;
    notes?: string;
  },
  db: Db,
) {
  const r = await query<{ id: string }>(
    `INSERT INTO disposal_records (waste_id, treatment_facility_id, operator_id, method, treated_at, disposed_at, certificate_no, notes)
     VALUES ($1,$2,$3,$4::disposal_method,$5,$6,$7,$8) RETURNING id`,
    [i.wasteId, i.facilityId, i.operatorId, i.method, i.treatedAt, i.disposedAt, i.certificateNo ?? null, i.notes ?? null],
    db,
  );
  return r.rows[0].id;
}

export async function treatmentFacility(id: string, db: Db) {
  return (
    await query<{ id: string; name: string; methods: string[]; is_active: boolean }>(
      'SELECT id, name, methods::text[] AS methods, is_active FROM treatment_facilities WHERE id = $1',
      [id],
      db,
    )
  ).rows[0] ?? null;
}

export async function activeTransportFor(wasteId: string, db: Db) {
  return (
    await query<{ destination_id: string }>(
      `SELECT destination_id FROM transport_records WHERE waste_id = $1 AND status = 'ARRIVED' ORDER BY created_at DESC LIMIT 1`,
      [wasteId],
      db,
    )
  ).rows[0] ?? null;
}
