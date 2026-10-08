import { beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { redis } from '../src/db/redis';
import { http, resetDb } from './helpers';

beforeAll(async () => {
  config.rateLimit.loginMax = 3; // strict limit for this file only
  await resetDb();
});

describe('rate limiting (Redis fixed window)', () => {
  it('blocks the 4th login attempt within the window with 429 and Retry-After', async () => {
    await redis.flushdb();
    const attempt = () => http().post('/api/auth/login').send({ email: 'admin@bmw.demo', password: 'wrong-wrong' });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});
