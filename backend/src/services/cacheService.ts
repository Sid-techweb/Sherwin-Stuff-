import crypto from 'crypto';
import { redis, safeRedis } from '../db/redis';

const VERSION_KEY = 'cache:version';

/**
 * Versioned cache. Every cached key embeds the current version number, so
 * "invalidate everything" is a single INCR - old keys become unreachable and expire by TTL.
 */
async function currentVersion(): Promise<string> {
  return safeRedis(async () => (await redis.get(VERSION_KEY)) ?? '0', '0');
}

export function hashKey(obj: unknown): string {
  return crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
}

export async function cached<T>(
  namespace: string,
  keyParts: unknown,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<{ value: T; cacheHit: boolean }> {
  const key = `${namespace}:v${await currentVersion()}:${hashKey(keyParts)}`;
  const hit = await safeRedis(() => redis.get(key), null);
  if (hit) return { value: JSON.parse(hit) as T, cacheHit: true };
  const value = await loader();
  await safeRedis(() => redis.set(key, JSON.stringify(value), 'EX', ttlSeconds), null);
  return { value, cacheHit: false };
}

/** Call after any write that can change dashboard numbers. */
export async function invalidateCaches(): Promise<void> {
  await safeRedis(() => redis.incr(VERSION_KEY), 0);
}
