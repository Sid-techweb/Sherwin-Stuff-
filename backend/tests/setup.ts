import { afterAll, beforeAll } from 'vitest';
import { pool } from '../src/db/pool';
import { connectRedis, redis } from '../src/db/redis';

beforeAll(async () => {
  await connectRedis();
  if (redis.status === 'ready') await redis.flushdb(); // logical DB 15 only (see config)
});

afterAll(async () => {
  await pool.end();
  redis.disconnect();
});
