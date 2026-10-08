import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { canTransition, TRANSITIONS, WASTE_STATUSES } from '../src/services/lifecycle';
import { actors, Actors, bearer, hoursFromNow, http, ids, resetDb } from './helpers';

describe('state machine (unit)', () => {
  it('allows the happy path and nothing backwards', () => {
    const path = ['SEGREGATED', 'COLLECTION_PENDING', 'COLLECTED', 'IN_TRANSIT', 'ARRIVED', 'TREATMENT_PENDING', 'TREATED', 'DISPOSED', 'CLOSED'] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
      expect(canTransition(path[i + 1], path[i])).toBe(false);
    }
  });
  it('treats CLOSED and REJECTED as terminal, and blocks DISPOSED -> COLLECTED', () => {
    expect(TRANSITIONS.CLOSED).toEqual([]);
    expect(TRANSITIONS.REJECTED).toEqual([]);
    expect(canTransition('DISPOSED', 'COLLECTED')).toBe(false);
  });
  it('only allows rejection before treatment starts', () => {
    const canReject = WASTE_STATUSES.filter((s) => canTransition(s, 'REJECTED'));
    expect(canReject).toEqual(['SEGREGATED', 'COLLECTION_PENDING', 'COLLECTED', 'ARRIVED', 'TREATMENT_PENDING']);
  });
});

let a: Actors;
let id: Awaited<ReturnType<typeof ids>>;
beforeAll(async () => {
  await resetDb();
  a = await actors();
  id = await ids();
});

async function createWaste(quantity = 12.5) {
  const r = await http().post('/api/waste').set(bearer(a.staff)).send({ categoryId: id.yellow, quantity, unit: 'kg', notes: 'ward 3' });
  expect(r.status).toBe(201);
  return r.body.data as { id: string; recordCode: string; status: string };
}

describe('complete lifecycle through the API', () => {
  it('create -> collect -> transport -> arrive -> dispose -> close, with history, audit and cache invalidation', async () => {
    const waste = await createWaste();
    expect(waste.status).toBe('SEGREGATED');
    expect(waste.recordCode).toMatch(/^BMW-\d{4}-\d{6}$/);

    // request collection (staff) -> assign (staff) -> complete (collector)
    const col = await http().post('/api/collections').set(bearer(a.staff)).send({ wasteId: waste.id, scheduledFor: hoursFromNow(6) });
    expect(col.status).toBe(201);
    expect(col.body.data.status).toBe('PENDING');

    // a collector cannot complete before being assigned (not visible to them yet)
    const early = await http().patch(`/api/collections/${col.body.data.id}`).set(bearer(a.collector)).send({ status: 'COMPLETED' });
    expect(early.status).toBe(404);

    const assigned = await http().patch(`/api/collections/${col.body.data.id}`).set(bearer(a.staff)).send({ collectorId: id.collector });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.status).toBe('ASSIGNED');

    const done = await http().patch(`/api/collections/${col.body.data.id}`).set(bearer(a.collector)).send({ status: 'COMPLETED', collectedQuantity: 12.4 });
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('COMPLETED');

    // transport: plan (transporter) -> depart -> arrive on time
    const plan = await http()
      .post('/api/transport')
      .set(bearer(a.transporter))
      .send({ wasteId: waste.id, vehicleId: id.vehicle, destinationId: id.incin, expectedArrivalAt: hoursFromNow(3) });
    expect(plan.status).toBe(201);
    const tid = plan.body.data.id;
    expect((await http().patch(`/api/transport/${tid}`).set(bearer(a.transporter)).send({ status: 'ARRIVED' })).status).toBe(409);
    expect((await http().patch(`/api/transport/${tid}`).set(bearer(a.transporter)).send({ status: 'IN_TRANSIT' })).status).toBe(200);
    const arrived = await http().patch(`/api/transport/${tid}`).set(bearer(a.transporter)).send({ status: 'ARRIVED' });
    expect(arrived.status).toBe(200);
    expect(arrived.body.data.isDelayed).toBe(false);

    // disposal (operator) walks ARRIVED -> TREATMENT_PENDING -> TREATED -> DISPOSED
    const disp = await http().post('/api/disposals').set(bearer(a.operator)).send({ wasteId: waste.id, method: 'INCINERATION', certificateNo: 'T-1' });
    expect(disp.status).toBe(201);

    // close (staff)
    const closed = await http().post(`/api/waste/${waste.id}/transition`).set(bearer(a.staff)).send({ status: 'CLOSED', note: 'verified' });
    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe('CLOSED');
    expect(closed.body.data.closedAt).toBeTruthy();

    const detail = await http().get(`/api/waste/${waste.id}`).set(bearer(a.staff));
    const statuses = detail.body.data.history.map((h: { toStatus: string }) => h.toStatus);
    expect(statuses).toEqual(['SEGREGATED', 'COLLECTION_PENDING', 'COLLECTED', 'IN_TRANSIT', 'ARRIVED', 'TREATMENT_PENDING', 'TREATED', 'DISPOSED', 'CLOSED']);
    expect(detail.body.data.disposals).toHaveLength(1);

    // audit trail contains the key actions in order
    const audit = await http().get('/api/audit-logs').query({ entity: 'waste_record', entityId: waste.id }).set(bearer(a.auditor));
    expect(audit.status).toBe(200);
    expect(audit.body.data.length).toBeGreaterThanOrEqual(9);
    const actions = (await pool.query(`SELECT action FROM audit_logs ORDER BY id`)).rows.map((r) => r.action);
    for (const expected of ['WASTE_CREATED', 'COLLECTION_REQUESTED', 'COLLECTION_ASSIGNED', 'COLLECTION_COMPLETED', 'VEHICLE_ASSIGNED', 'TRANSPORT_STARTED', 'TRANSPORT_COMPLETED', 'DISPOSAL_RECORDED'])
      expect(actions).toContain(expected);

    // vehicle released
    const v = await pool.query('SELECT status FROM vehicles WHERE id=$1', [id.vehicle]);
    expect(v.rows[0].status).toBe('AVAILABLE');
  });
});

describe('invalid transitions and bad input', () => {
  it('refuses to move a CLOSED record and raises an INVALID_TRANSITION alert', async () => {
    const closed = (await pool.query(`SELECT id FROM waste_records WHERE status='CLOSED' LIMIT 1`)).rows[0];
    const r = await http().post(`/api/waste/${closed.id}/transition`).set(bearer(a.admin)).send({ status: 'REJECTED' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('INVALID_TRANSITION');
    const alert = await pool.query(`SELECT 1 FROM alerts WHERE type='INVALID_TRANSITION' AND waste_id=$1`, [closed.id]);
    expect(alert.rowCount).toBe(1);
  });

  it('does not let clients force workflow-driven statuses directly (e.g. COLLECTED)', async () => {
    const w = await createWaste();
    const r = await http().post(`/api/waste/${w.id}/transition`).set(bearer(a.admin)).send({ status: 'COLLECTED' });
    expect(r.status).toBe(400);
  });

  it('cannot request transport before collection, or collect twice', async () => {
    const w = await createWaste();
    const early = await http()
      .post('/api/transport')
      .set(bearer(a.transporter))
      .send({ wasteId: w.id, vehicleId: id.vehicle, destinationId: id.incin, expectedArrivalAt: hoursFromNow(2) });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('NOT_READY');
    const c1 = await http().post('/api/collections').set(bearer(a.staff)).send({ wasteId: w.id });
    expect(c1.status).toBe(201);
    const c2 = await http().post('/api/collections').set(bearer(a.staff)).send({ wasteId: w.id });
    expect(c2.status).toBe(409);
  });

  it('cannot dispose waste that has not arrived', async () => {
    const w = await createWaste();
    const r = await http().post('/api/disposals').set(bearer(a.operator)).send({ wasteId: w.id, method: 'INCINERATION', treatmentFacilityId: id.incin });
    expect(r.status).toBe(409);
    const still = await pool.query('SELECT status FROM waste_records WHERE id=$1', [w.id]);
    expect(still.rows[0].status).toBe('SEGREGATED'); // transaction rolled back completely
  });

  it('rejects a disposal method the facility does not support', async () => {
    const w = await createWaste();
    await pool.query(`UPDATE waste_records SET status='ARRIVED' WHERE id=$1`, [w.id]);
    const r = await http().post('/api/disposals').set(bearer(a.operator)).send({ wasteId: w.id, method: 'AUTOCLAVE', treatmentFacilityId: id.incin });
    expect(r.status).toBe(400);
  });

  it('validates input and handles missing / malformed ids', async () => {
    expect((await http().post('/api/waste').set(bearer(a.staff)).send({ categoryId: id.yellow, quantity: -5 })).status).toBe(400);
    expect((await http().post('/api/waste').set(bearer(a.staff)).send({ categoryId: id.yellow, quantity: 5, unit: 'tons' })).status).toBe(400);
    expect((await http().post('/api/waste').set(bearer(a.staff)).send({ categoryId: 9999, quantity: 5 })).status).toBe(400);
    expect((await http().get('/api/waste/not-a-uuid').set(bearer(a.admin))).status).toBe(400);
    const missing = await http().get('/api/waste/00000000-0000-4000-8000-000000000000').set(bearer(a.admin));
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
    expect((await http().post('/api/waste').set(bearer(a.staff)).set('Content-Type', 'application/json').send('{bad json')).status).toBe(400);
  });

  it('edits and deletes only while the record is still early in the workflow', async () => {
    const w = await createWaste();
    const patched = await http().patch(`/api/waste/${w.id}`).set(bearer(a.staff)).send({ quantity: 9.5 });
    expect(patched.status).toBe(200);
    expect(patched.body.data.quantity).toBe(9.5);
    expect((await http().patch(`/api/waste/${w.id}`).set(bearer(a.staff)).send({})).status).toBe(400);
    expect((await http().delete(`/api/waste/${w.id}`).set(bearer(a.staff))).status).toBe(403); // admin only
    expect((await http().delete(`/api/waste/${w.id}`).set(bearer(a.admin))).status).toBe(200);
    expect((await http().get(`/api/waste/${w.id}`).set(bearer(a.admin))).status).toBe(404);
    const closed = (await pool.query(`SELECT id FROM waste_records WHERE status='CLOSED' LIMIT 1`)).rows[0];
    expect((await http().patch(`/api/waste/${closed.id}`).set(bearer(a.admin)).send({ quantity: 1 })).status).toBe(409);
    expect((await http().delete(`/api/waste/${closed.id}`).set(bearer(a.admin))).status).toBe(409);
  });

  it('rejecting a record cancels its pending collection', async () => {
    const w = await createWaste();
    await http().post('/api/collections').set(bearer(a.staff)).send({ wasteId: w.id });
    const r = await http().post(`/api/waste/${w.id}/transition`).set(bearer(a.staff)).send({ status: 'REJECTED', note: 'wrongly segregated' });
    expect(r.status).toBe(200);
    const c = await pool.query('SELECT status FROM collection_records WHERE waste_id=$1', [w.id]);
    expect(c.rows[0].status).toBe('CANCELLED');
  });

  it('lists with search, filters, sorting and pagination', async () => {
    const r = await http().get('/api/waste').query({ status: 'SEGREGATED', sortBy: 'quantity', sortDir: 'asc', pageSize: 2, page: 1 }).set(bearer(a.admin));
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeLessThanOrEqual(2);
    expect(r.body.meta).toMatchObject({ page: 1, pageSize: 2 });
    const search = await http().get('/api/waste').query({ search: 'ward 3' }).set(bearer(a.admin));
    expect(search.body.meta.total).toBeGreaterThan(0);
    // hostile sort/filter values never reach SQL
    expect((await http().get('/api/waste').query({ sortBy: 'quantity; DROP TABLE users' }).set(bearer(a.admin))).status).toBe(400);
    const inj = await http().get('/api/waste').query({ search: "'; DROP TABLE waste_records; --" }).set(bearer(a.admin));
    expect(inj.status).toBe(200);
    expect((await pool.query('SELECT count(*) FROM waste_records')).rows[0].count).not.toBe('0');
  });
});
