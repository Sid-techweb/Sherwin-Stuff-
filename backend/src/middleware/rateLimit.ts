import { NextFunction, Request, Response } from 'express';
import { redis, safeRedis } from '../db/redis';
import { AppError } from '../utils/errors';

/**
 * Fixed-window rate limiter backed by Redis (INCR + EXPIRE).
 * Fails open: if Redis is unavailable the request is allowed.
 */
export function rateLimit(scope: string, max: () => number, windowSeconds: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = `rl:${scope}:${req.ip}`;
    const count = await safeRedis(async () => {
      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, windowSeconds);
      return n;
    }, 0);
    if (count > max()) {
      res.setHeader('Retry-After', String(windowSeconds));
      return next(new AppError(429, 'RATE_LIMITED', 'Too many requests, please slow down'));
    }
    next();
  };
}
