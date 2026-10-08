import { beforeAll, describe, expect, it } from 'vitest';
import { actors, Actors, bearer, http, ids, resetDb } from './helpers';
import { DEMO_PASSWORD } from '../src/db/seed';

let a: Actors;
beforeAll(async () => {
  await resetDb();
  a = await actors();
});

describe('authentication', () => {
  it('logs in with valid credentials and returns a JWT plus user', async () => {
    const r = await http().post('/api/auth/login').send({ email: 'admin@bmw.demo', password: DEMO_PASSWORD });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data.token.split('.')).toHaveLength(3);
    expect(r.body.data.user).toMatchObject({ email: 'admin@bmw.demo', role: 'ADMIN' });
    expect(JSON.stringify(r.body)).not.toContain('password_hash');
  });

  it('rejects a wrong password and an unknown email with the same 401 message', async () => {
    const bad = await http().post('/api/auth/login').send({ email: 'admin@bmw.demo', password: 'nope-nope' });
    const unknown = await http().post('/api/auth/login').send({ email: 'ghost@bmw.demo', password: 'nope-nope' });
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.body.error.message).toBe(unknown.body.error.message);
  });

  it('validates the login body', async () => {
    const r = await http().post('/api/auth/login').send({ email: 'not-an-email' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires a token for protected routes and rejects garbage tokens', async () => {
    expect((await http().get('/api/waste')).status).toBe(401);
    expect((await http().get('/api/waste').set(bearer('not.a.token'))).status).toBe(401);
  });

  it('returns the current user on /auth/me', async () => {
    const r = await http().get('/api/auth/me').set(bearer(a.staff));
    expect(r.status).toBe(200);
    expect(r.body.data.role).toBe('HOSPITAL_STAFF');
  });

  it('health endpoint reports database and redis', async () => {
    const r = await http().get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body.data.database).toBe(true);
    expect(r.body.data.redis).toBe(true);
  });
});

describe('registration (admin only)', () => {
  const body = { email: 'new.collector@bmw.demo', name: 'New Collector', password: 'Strong#Pass1', role: 'WASTE_COLLECTOR' };

  it('forbids non-admins', async () => {
    expect((await http().post('/api/auth/register').set(bearer(a.staff)).send(body)).status).toBe(403);
    expect((await http().post('/api/auth/register').send(body)).status).toBe(401);
  });

  it('admin can create a user who can then log in; duplicate email is 409', async () => {
    const ok = await http().post('/api/auth/register').set(bearer(a.admin)).send(body);
    expect(ok.status).toBe(201);
    expect(ok.body.data.role).toBe('WASTE_COLLECTOR');
    const login = await http().post('/api/auth/login').send({ email: body.email, password: body.password });
    expect(login.status).toBe(200);
    const dup = await http().post('/api/auth/register').set(bearer(a.admin)).send(body);
    expect(dup.status).toBe(409);
  });

  it('enforces password strength and facility for hospital staff', async () => {
    const weak = await http().post('/api/auth/register').set(bearer(a.admin)).send({ ...body, email: 'w@bmw.demo', password: 'short' });
    expect(weak.status).toBe(400);
    const noFacility = await http()
      .post('/api/auth/register')
      .set(bearer(a.admin))
      .send({ ...body, email: 'nf@bmw.demo', role: 'HOSPITAL_STAFF' });
    expect(noFacility.status).toBe(400);
    const { dgh } = await ids();
    const withFacility = await http()
      .post('/api/auth/register')
      .set(bearer(a.admin))
      .send({ ...body, email: 'wf@bmw.demo', role: 'HOSPITAL_STAFF', facilityId: dgh });
    expect(withFacility.status).toBe(201);
  });
});
