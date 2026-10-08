import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Redis is an optimisation layer, never a source of truth.
 * Commands fail fast (no offline queue) so a Redis outage cannot hang API requests.
 */
export const redis = new Redis(config.redisUrl, {
  db: config.redisDb,
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  retryStrategy: (times) => Math.min(times * 500, 5000),
});

redis.on('error', (err) => logger.warn({ err: err.message }, 'redis error'));

export async function connectRedis() {
  try {
    await redis.connect();
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Redis unavailable at startup; running without cache');
  }
}

/** Run a Redis operation; on failure return the fallback instead of throwing (fail-open). */
export async function safeRedis<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    if (redis.status !== 'ready') return fallback;
    return await fn();
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'redis operation failed; continuing without it');
    return fallback;
  }
}
