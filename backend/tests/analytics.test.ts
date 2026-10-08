import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { seedDemo } from '../src/db/seed';
import { resolvePeriod } from '../src/ai/period';
import { actors, Actors, bearer, http, resetDb } from './helpers';

let a: Actors;
beforeAll(async () => {
  const ref = await resetDb();
  await seedDemo(pool, ref, 120);
  a = await actors();
});

describe('operational analytics are computed from real timestamps', () => {
  it('matches independent SQL for averages and percentages', async () => {
    const r = await http().get('/api/analytics/operational').set(bearer(a.admin));
    expect(r.status).toBe(200);
    const d = r.body.data;
    const sql = await pool.query(`
      SELECT round((avg(extract(epoch from collected_at - requested_at)) FILTER (WHERE status='COMPLETED') / 3600.0)::numeric, 1)::float AS col FROM collection_records`);
    expect(d.avgCollectionHours).toBeCloseTo(sql.rows[0].col, 1);
    const t = await pool.query(`
      SELECT count(*) FILTER (WHERE status='ARRIVED')::int AS arrived, count(*) FILTER (WHERE status='ARRIVED' AND is_delayed)::int AS delayed FROM transport_records`);
    expect(d.sample.arrivedTransports).toBe(t.rows[0].arrived);
    expect(d.delayedTransportPct).toBeCloseTo((t.rows[0].delayed / t.rows[0].arrived) * 100, 1);
    expect(d.avgTransportHours).toBeGreaterThan(0);
    expect(d.avgLifecycleHours).toBeGreaterThan(d.avgTransportHours);
    expect(d.byFacility.length).toBe(5);
  });

  it('is cached, scoped for hospital staff, and restricted by role', async () => {
    const first = await http().get('/api/analytics/operational').set(bearer(a.admin));
    expect(first.headers['x-cache']).toBe('HIT');
    const staff = await http().get('/api/analytics/operational').set(bearer(a.staff));
    expect(staff.status).toBe(200);
    expect(staff.body.data.byFacility).toHaveLength(1);
    expect((await http().get('/api/analytics/operational').set(bearer(a.collector))).status).toBe(403);
    expect((await http().get('/api/analytics/operational').query({ from: 'bad' }).set(bearer(a.admin))).status).toBe(400);
  });

  it('Riverside (seeded with repeated delays) has the highest delay rate', async () => {
    const d = (await http().get('/api/analytics/operational').set(bearer(a.admin))).body.data;
    const worst = [...d.byFacility].filter((f: { arrivedTransports: number }) => f.arrivedTransports >= 5).sort((x: { delayedPct: number }, y: { delayedPct: number }) => y.delayedPct - x.delayedPct)[0];
    expect(worst.name).toBe('Demo Riverside Hospital');
  });
});

describe('period resolution', () => {
  const now = new Date(2026, 9, 14, 15, 30); // Wed 14 Oct 2026
  it('this_month starts on the 1st; last_month is the full previous month', () => {
    expect(new Date(resolvePeriod('this_month', now).from!).getDate()).toBe(1);
    const lm = resolvePeriod('last_month', now);
    expect(new Date(lm.from!).getMonth()).toBe(8);
    expect(new Date(lm.to!).getMonth()).toBe(8);
    expect(new Date(lm.to!).getDate()).toBe(30);
  });
  it('this_week starts on Monday; all_time has no bounds', () => {
    expect(new Date(resolvePeriod('this_week', now).from!).getDay()).toBe(1);
    expect(resolvePeriod('all_time', now).from).toBeUndefined();
  });
});
