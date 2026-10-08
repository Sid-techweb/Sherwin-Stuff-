import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { scan } from '../src/services/alertService';
import { actors, Actors, bearer, hoursFromNow, http, ids, resetDb } from './helpers';

let a: Actors;
let id: Awaited<ReturnType<typeof ids>>;
beforeAll(async () => {
  await resetDb();
  a = await actors();
  id = await ids();
});

async function createWaste(quantity = 10) {
  const r = await http().post('/api/waste').set(bearer(a.staff)).send({ categoryId: id.yellow, quantity });
  return r.body.data.id as string;
}
async function toCollected(wasteId: string) {
  const c = await http().post('/api/collections').set(bearer(a.staff)).send({ wasteId });
  await http().patch(`/api/collections/${c.body.data.id}`).set(bearer(a.staff)).send({ collectorId: id.collector });
  await http().patch(`/api/collections/${c.body.data.id}`).set(bearer(a.collector)).send({ status: 'COMPLETED' });
}
const alertsOf = async (wasteId: string, type: string) =>
  (await pool.query('SELECT * FROM alerts WHERE waste_id=$1 AND type=$2', [wasteId, type])).rows;

describe('alert generation', () => {
  it('raises EXCESSIVE_QUANTITY when quantity exceeds the category threshold (and not below it)', async () => {
    const small = await createWaste(10);
    const big = await createWaste(200); // YELLOW threshold is 60 kg
    expect(await alertsOf(small, 'EXCESSIVE_QUANTITY')).toHaveLength(0);
    const rows = await alertsOf(big, 'EXCESSIVE_QUANTITY');
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe('HIGH'); // > 2x threshold
    expect(rows[0].status).toBe('OPEN');
  });

  it('raises a DELAYED_TRANSPORT alert when actual arrival is after expected arrival', async () => {
    const w = await createWaste();
    await toCollected(w);
    const plan = await http()
      .post('/api/transport')
      .set(bearer(a.transporter))
      .send({ wasteId: w, vehicleId: id.vehicle, destinationId: id.incin, expectedArrivalAt: hoursFromNow(1) });
    const tid = plan.body.data.id;
    await http().patch(`/api/transport/${tid}`).set(bearer(a.transporter)).send({ status: 'IN_TRANSIT' });
    // arrival reported 3 hours after the expected time
    const arrivedAt = new Date(Date.now()).toISOString();
    await pool.query(`UPDATE transport_records SET expected_arrival_at = now() - interval '3 hours', departed_at = now() - interval '4 hours' WHERE id=$1`, [tid]);
    const r = await http().patch(`/api/transport/${tid}`).set(bearer(a.transporter)).send({ status: 'ARRIVED', arrivedAt });
    expect(r.status).toBe(200);
    expect(r.body.data.isDelayed).toBe(true);
    const rows = await alertsOf(w, 'DELAYED_TRANSPORT');
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe('HIGH'); // 180 min late
  });

  it('an on-time arrival does not create an alert', async () => {
    const w = await createWaste();
    await toCollected(w);
    const plan = await http()
      .post('/api/transport')
      .set(bearer(a.transporter))
      .send({ wasteId: w, vehicleId: id.vehicle, destinationId: id.incin, expectedArrivalAt: hoursFromNow(5) });
    await http().patch(`/api/transport/${plan.body.data.id}`).set(bearer(a.transporter)).send({ status: 'IN_TRANSIT' });
    await http().patch(`/api/transport/${plan.body.data.id}`).set(bearer(a.transporter)).send({ status: 'ARRIVED' });
    expect(await alertsOf(w, 'DELAYED_TRANSPORT')).toHaveLength(0);
  });

  it('the periodic scan finds overdue collections, in-transit delays, unassigned waste and missing disposals - idempotently', async () => {
    const overdueCollection = await createWaste();
    await http().post('/api/collections').set(bearer(a.staff)).send({ wasteId: overdueCollection });
    await pool.query(`UPDATE collection_records SET scheduled_for = now() - interval '2 hours' WHERE waste_id=$1`, [overdueCollection]);

    const lateTransit = await createWaste();
    await toCollected(lateTransit);
    const plan = await http()
      .post('/api/transport')
      .set(bearer(a.admin))
      .send({ wasteId: lateTransit, vehicleId: id.vehicle2, destinationId: id.incin, expectedArrivalAt: hoursFromNow(4), transporterId: (await pool.query(`SELECT id FROM users WHERE email='transporter2@bmw.demo'`)).rows[0].id });
    await http().patch(`/api/transport/${plan.body.data.id}`).set(bearer(a.admin)).send({ status: 'IN_TRANSIT' });
    await pool.query(`UPDATE transport_records SET expected_arrival_at = now() - interval '1 hour' WHERE id=$1`, [plan.body.data.id]);

    const stale = await createWaste();
    await pool.query(`UPDATE waste_records SET generated_at = now() - interval '60 hours' WHERE id=$1`, [stale]); // 48h limit

    const noDisposal = await createWaste();
    await pool.query(`UPDATE waste_records SET status='ARRIVED', updated_at = now() - interval '30 hours' WHERE id=$1`, [noDisposal]);

    const first = await scan();
    expect(first.skipped).toBe(false);
    expect(await alertsOf(overdueCollection, 'DELAYED_COLLECTION')).toHaveLength(1);
    expect(await alertsOf(lateTransit, 'DELAYED_TRANSPORT')).toHaveLength(1);
    expect(await alertsOf(stale, 'UNASSIGNED_WASTE')).toHaveLength(1);
    expect(await alertsOf(noDisposal, 'MISSING_DISPOSAL')).toHaveLength(1);

    const second = await scan();
    expect(Object.values(second.created).reduce((s, n) => s + n, 0)).toBe(0); // no duplicates

    // recording the disposal auto-resolves the MISSING_DISPOSAL alert
    const disp = await http().post('/api/disposals').set(bearer(a.operator)).send({ wasteId: noDisposal, method: 'INCINERATION', treatmentFacilityId: id.incin });
    expect(disp.status).toBe(201);
    expect((await alertsOf(noDisposal, 'MISSING_DISPOSAL'))[0].status).toBe('RESOLVED');
  });
});

describe('alert API', () => {
  it('lists, filters, acknowledges and resolves alerts; resolved cannot be changed again', async () => {
    const list = await http().get('/api/alerts').query({ status: 'OPEN', severity: 'HIGH' }).set(bearer(a.admin));
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    expect(list.body.data.every((x: { severity: string }) => x.severity === 'HIGH')).toBe(true);
    const alertId = list.body.data[0].id;
    expect((await http().patch(`/api/alerts/${alertId}`).set(bearer(a.auditor)).send({ status: 'RESOLVED' })).status).toBe(403);
    expect((await http().patch(`/api/alerts/${alertId}`).set(bearer(a.admin)).send({ status: 'ACKNOWLEDGED' })).status).toBe(200);
    expect((await http().patch(`/api/alerts/${alertId}`).set(bearer(a.admin)).send({ status: 'RESOLVED' })).status).toBe(200);
    expect((await http().patch(`/api/alerts/${alertId}`).set(bearer(a.admin)).send({ status: 'RESOLVED' })).status).toBe(409);
    const audit = await pool.query(`SELECT 1 FROM audit_logs WHERE action='ALERT_RESOLVED' AND entity_id=$1`, [alertId]);
    expect(audit.rowCount).toBe(1);
  });

  it('allows manual vehicle/segregation alerts but not forged system alert types', async () => {
    const ok = await http().post('/api/alerts').set(bearer(a.transporter)).send({ type: 'VEHICLE_ISSUE', severity: 'MEDIUM', message: 'Tyre pressure low' });
    expect(ok.status).toBe(201);
    const forged = await http().post('/api/alerts').set(bearer(a.transporter)).send({ type: 'DELAYED_TRANSPORT', severity: 'LOW', message: 'fake' });
    expect(forged.status).toBe(400);
    expect((await http().post('/api/alerts').set(bearer(a.collector)).send({ type: 'VEHICLE_ISSUE', severity: 'LOW', message: 'x y z' })).status).toBe(403);
  });

  it('hospital staff only see alerts for their own facility', async () => {
    const dccAlerts = await http().get('/api/alerts').set(bearer(a.staffOther));
    expect(dccAlerts.body.data.every((x: { facilityName: string | null }) => x.facilityName !== 'Demo General Hospital')).toBe(true);
    const dghAlerts = await http().get('/api/alerts').set(bearer(a.staff));
    expect(dghAlerts.body.data.length).toBeGreaterThan(0);
  });
});
