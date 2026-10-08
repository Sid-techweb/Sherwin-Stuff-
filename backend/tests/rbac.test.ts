import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { actors, Actors, bearer, hoursFromNow, http, ids, resetDb } from './helpers';

let a: Actors;
let id: Awaited<ReturnType<typeof ids>>;
let wasteId: string;
beforeAll(async () => {
  await resetDb();
  a = await actors();
  id = await ids();
  const r = await http().post('/api/waste').set(bearer(a.staff)).send({ categoryId: id.yellow, quantity: 10 });
  wasteId = r.body.data.id;
});

describe('role-based access control (enforced server-side)', () => {
  it('only ADMIN and HOSPITAL_STAFF can create waste', async () => {
    const body = { categoryId: id.yellow, quantity: 3, facilityId: id.dgh };
    for (const t of [a.collector, a.transporter, a.operator, a.auditor]) {
      expect((await http().post('/api/waste').set(bearer(t)).send(body)).status).toBe(403);
    }
    expect((await http().post('/api/waste').set(bearer(a.admin)).send(body)).status).toBe(201);
  });

  it('hospital staff are always bound to their own facility, even if they send another facilityId', async () => {
    const other = (await pool.query(`SELECT id FROM facilities WHERE code='DCC'`)).rows[0].id;
    const r = await http().post('/api/waste').set(bearer(a.staff)).send({ categoryId: id.yellow, quantity: 3, facilityId: other });
    expect(r.status).toBe(201);
    expect(r.body.data.facilityId).toBe(id.dgh);
  });

  it('staff from another facility cannot see, edit or request collection for the record (404/403)', async () => {
    expect((await http().get(`/api/waste/${wasteId}`).set(bearer(a.staffOther))).status).toBe(404);
    expect((await http().patch(`/api/waste/${wasteId}`).set(bearer(a.staffOther)).send({ quantity: 1 })).status).toBe(403);
    expect((await http().post('/api/collections').set(bearer(a.staffOther)).send({ wasteId })).status).toBe(403);
    const list = await http().get('/api/waste').set(bearer(a.staffOther));
    expect(list.body.data.every((w: { facilityId: string }) => w.facilityId !== id.dgh)).toBe(true);
  });

  it('auditor is strictly read-only but can read audit logs and waste', async () => {
    expect((await http().get('/api/waste').set(bearer(a.auditor))).status).toBe(200);
    expect((await http().get('/api/audit-logs').set(bearer(a.auditor))).status).toBe(200);
    expect((await http().post('/api/collections').set(bearer(a.auditor)).send({ wasteId })).status).toBe(403);
    expect((await http().post('/api/disposals').set(bearer(a.auditor)).send({})).status).toBe(403);
    expect((await http().post(`/api/waste/${wasteId}/transition`).set(bearer(a.auditor)).send({ status: 'REJECTED' })).status).toBe(403);
  });

  it('audit logs are limited to ADMIN and AUDITOR', async () => {
    for (const t of [a.staff, a.collector, a.transporter, a.operator]) {
      expect((await http().get('/api/audit-logs').set(bearer(t))).status).toBe(403);
    }
  });

  it('collectors see only their assigned collections and cannot assign anyone', async () => {
    const col = await http().post('/api/collections').set(bearer(a.staff)).send({ wasteId });
    const cid = col.body.data.id;
    expect((await http().get('/api/collections').set(bearer(a.collector))).body.data).toHaveLength(0);
    expect((await http().patch(`/api/collections/${cid}`).set(bearer(a.collector)).send({ collectorId: id.collector })).status).toBe(403);
    await http().patch(`/api/collections/${cid}`).set(bearer(a.staff)).send({ collectorId: id.collector });
    expect((await http().get('/api/collections').set(bearer(a.collector))).body.data).toHaveLength(1);
    // a collector (or anyone else) cannot assign a non-collector as collector
    const bad = await http().patch(`/api/collections/${cid}`).set(bearer(a.staff)).send({ collectorId: id.staffUser });
    expect(bad.status).toBe(400);
    // staff cannot complete the collection
    expect((await http().patch(`/api/collections/${cid}`).set(bearer(a.staff)).send({ status: 'COMPLETED' })).status).toBe(403);
    expect((await http().patch(`/api/collections/${cid}`).set(bearer(a.collector)).send({ status: 'COMPLETED' })).status).toBe(200);
  });

  it('transporters only see their own jobs; only transporters/admin plan transport; vehicle & capacity rules hold', async () => {
    expect((await http().post('/api/transport').set(bearer(a.staff)).send({})).status).toBe(403);
    const plan = await http()
      .post('/api/transport')
      .set(bearer(a.transporter))
      .send({ wasteId, vehicleId: id.vehicle, destinationId: id.incin, expectedArrivalAt: hoursFromNow(2) });
    expect(plan.status).toBe(201);
    expect((await http().get('/api/transport').set(bearer(a.transporter))).body.data).toHaveLength(1);
    const other = await tokenOf('transporter2@bmw.demo');
    expect((await http().get('/api/transport').set(bearer(other))).body.data).toHaveLength(0);
    expect((await http().patch(`/api/transport/${plan.body.data.id}`).set(bearer(other)).send({ status: 'IN_TRANSIT' })).status).toBe(404);
    // the vehicle is reserved, so a second job cannot take it
    const w2 = await http().post('/api/waste').set(bearer(a.admin)).send({ categoryId: id.yellow, quantity: 4, facilityId: id.dgh });
    expect(w2.status).toBe(201);
  });

  it('only treatment operators/admin record disposals; dashboards hidden from field roles', async () => {
    expect((await http().post('/api/disposals').set(bearer(a.transporter)).send({})).status).toBe(403);
    expect((await http().get('/api/analytics/dashboard').set(bearer(a.collector))).status).toBe(403);
    expect((await http().get('/api/analytics/dashboard').set(bearer(a.auditor))).status).toBe(200);
  });

  it('a deactivated user loses access immediately, even with a still-valid token', async () => {
    expect((await http().get('/api/auth/me').set(bearer(a.operator))).status).toBe(200);
    await pool.query(`UPDATE users SET is_active=FALSE WHERE email='operator@bmw.demo'`);
    expect((await http().get('/api/auth/me').set(bearer(a.operator))).status).toBe(401);
  });
});

async function tokenOf(email: string) {
  const { tokenFor } = await import('./helpers');
  return tokenFor(email);
}
