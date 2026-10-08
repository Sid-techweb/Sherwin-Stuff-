import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4100),
  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().default('redis://localhost:6390'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DASHBOARD_CACHE_TTL_SECONDS: z.coerce.number().default(60),
  ALERT_SCAN_INTERVAL_MS: z.coerce.number().default(300000),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().default(60),
  RATE_LIMIT_MAX: z.coerce.number().default(300),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().default(10),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast with a readable message instead of running half-configured.
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
const env = parsed.data;
const isTest = env.NODE_ENV === 'test';

export const config = {
  env: env.NODE_ENV,
  isTest,
  port: env.PORT,
  databaseUrl: isTest && env.TEST_DATABASE_URL ? env.TEST_DATABASE_URL : env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  // tests use a separate Redis logical DB so they never touch the dev cache
  redisDb: isTest ? 15 : 0,
  jwtSecret: env.JWT_SECRET,
  jwtExpiresIn: env.JWT_EXPIRES_IN,
  corsOrigin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
  dashboardCacheTtl: env.DASHBOARD_CACHE_TTL_SECONDS,
  alertScanIntervalMs: env.ALERT_SCAN_INTERVAL_MS,
  rateLimit: {
    windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
    max: env.RATE_LIMIT_MAX,
    loginMax: env.LOGIN_RATE_LIMIT_MAX,
  },
};
