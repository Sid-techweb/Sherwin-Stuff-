import { beforeAll, describe, expect, it } from 'vitest';

import { pool } from '../src/db/pool';
import { redis } from '../src/db/redis';
import { actors, Actors, bearer, http, ids, resetDb } from './helpers';
import { DEMO_PASSWORD } from '../src/db/seed';

let a: Actors;
let id: Awaited<ReturnType<typeof ids>>;

describe('Redis: dashboard cache, invalidation and fail-open behaviour', () => {
  beforeAll(async () => {
    await resetDb();
    a = await actors();
    id = await ids();
  });

  it('serves the second identical dashboard request from Redis', async () => {
    const first = await http().get('/api/analytics/dashboard').set(bearer(a.admin));
    expect(first.status).toBe(200);
    expect(first.headers['x-cache']).toBe('MISS');
    const second = await http().get('/api/analytics/dashboard').set(bearer(a.admin));
    expect(second.headers['x-cache']).toBe('HIT');
    expect(second.body.data).toEqual(first.body.data);
    const keys = await redis.keys('dash:*');
    expect(keys.length).toBeGreaterThan(0);
    expect(await redis.ttl(keys[0])).toBeGreaterThan(0);
  });

  it('caches per filter set and per facility scope', async () => {
    const filtered = await http().get('/api/analytics/dashboard').query({ facilityId: id.dgh }).set(bearer(a.admin));
    expect(filtered.headers['x-cache']).toBe('MISS');
    const staff = await http().get('/api/analytics/dashboard').set(bearer(a.staff));
    expect(staff.headers['x-cache']).toBe('MISS'); // staff scope differs from admin scope
  });

  it('invalidates the cache when data changes, and the new numbers are correct', async () => {
    const before = await http().get('/api/analytics/dashboard').set(bearer(a.admin));
    expect(before.headers['x-cache']).toBe('HIT');
    const n = before.body.data.totals.records;
    const created = await http().post('/api/waste').set(bearer(a.staff)).send({ categoryId: id.yellow, quantity: 7 });
    expect(created.status).toBe(201);
    const after = await http().get('/api/analytics/dashboard').set(bearer(a.admin));
    expect(after.headers['x-cache']).toBe('MISS');
    expect(after.body.data.totals.records).toBe(n + 1);
    expect(after.body.data.totals.quantityKg).toBeCloseTo(before.body.data.totals.quantityKg + 7, 2);
  });

  it('dashboard numbers come from PostgreSQL and match direct SQL', async () => {
    const d = (await http().get('/api/analytics/dashboard').set(bearer(a.admin))).body.data;
    const sql = await pool.query(`SELECT count(*)::int n, coalesce(sum(quantity),0)::float kg FROM waste_records`);
    expect(d.totals.records).toBe(sql.rows[0].n);
    expect(d.totals.quantityKg).toBeCloseTo(sql.rows[0].kg, 2);
    expect(d.byCategory[0]).toMatchObject({ code: 'YELLOW' });
    expect(d.overTime.length).toBeGreaterThan(0);
  });

  it('validates dashboard filters', async () => {
    expect((await http().get('/api/analytics/dashboard').query({ from: 'yesterday' }).set(bearer(a.admin))).status).toBe(400);
    expect((await http().get('/api/analytics/dashboard').query({ status: 'NOPE' }).set(bearer(a.admin))).status).toBe(400);
  });

  it('fails open when Redis is unavailable: API keeps working straight from PostgreSQL', async () => {
    await redis.flushdb();
    redis.disconnect(); // simulate outage
    const dash = await http().get('/api/analytics/dashboard').set(bearer(a.admin));
    expect(dash.status).toBe(200);
    expect(dash.headers['x-cache']).toBe('MISS');
    const login = await http().post('/api/auth/login').send({ email: 'admin@bmw.demo', password: DEMO_PASSWORD });
    expect(login.status).toBe(200); // rate limiter skipped, not blocking
    const health = await http().get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.data.status).toBe('degraded');
    const write = await http().post('/api/waste').set(bearer(a.staff)).send({ categoryId: id.yellow, quantity: 1 });
    expect(write.status).toBe(201);
  });
});
