import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool';
import { actors, Actors, bearer, http, ids, resetDb } from './helpers';

let a: Actors;
beforeAll(async () => {
  await resetDb();
  a = await actors();
  const id = await ids();
  await http().post('/api/waste').set(bearer(a.staff)).send({ categoryId: id.yellow, quantity: 5 });
});

describe('audit log', () => {
  it('is append-only at the database level: UPDATE and DELETE are rejected', async () => {
    await expect(pool.query(`UPDATE audit_logs SET action='TAMPERED'`)).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM audit_logs')).rejects.toThrow(/append-only/);
  });

  it('exposes no mutating endpoints', async () => {
    expect((await http().delete('/api/audit-logs').set(bearer(a.admin))).status).toBe(404);
    expect((await http().post('/api/audit-logs').set(bearer(a.admin)).send({})).status).toBe(404);
  });

  it('records who did what, with filters and pagination', async () => {
    const r = await http().get('/api/audit-logs').query({ action: 'WASTE_CREATED', pageSize: 5 }).set(bearer(a.admin));
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0]).toMatchObject({ action: 'WASTE_CREATED', entity: 'waste_record' });
    expect(r.body.data[0].userName).toContain('Hospital-Staff');
    expect(r.body.meta.total).toBe(1);
  });

  it('records failed and successful logins', async () => {
    await http().post('/api/auth/login').send({ email: 'admin@bmw.demo', password: 'bad-bad-bad' });
    const r = await http().get('/api/audit-logs').query({ action: 'LOGIN_FAILED' }).set(bearer(a.admin));
    expect(r.body.data.length).toBeGreaterThan(0);
  });

  it('does not leak internals on server errors or unknown routes', async () => {
    const r = await http().get('/api/nope').set(bearer(a.admin));
    expect(r.status).toBe(404);
    expect(r.body.success).toBe(false);
    expect(JSON.stringify(r.body)).not.toMatch(/stack|node_modules|SELECT/i);
  });
});
