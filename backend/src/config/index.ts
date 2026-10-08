import 'dotenv/config';
import { z } from 'zod';

// Empty strings in .env / docker-compose mean "not set".
const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

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
  // --- AI assistant (all optional: without an LLM key the assistant runs in data-only "offline" mode) ---
  LLM_PROVIDER: z.preprocess(emptyToUndefined, z.enum(['none', 'anthropic', 'openai']).default('none')), // 'openai' = any OpenAI-compatible API
  LLM_MODEL: z.preprocess(emptyToUndefined, z.string().optional()),
  LLM_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  LLM_BASE_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  LLM_MAX_TOKENS: z.coerce.number().default(1024),
  AI_TIMEOUT_MS: z.coerce.number().default(30000),
  AI_RATE_LIMIT_MAX: z.coerce.number().default(20),
  HINDSIGHT_URL: z.preprocess(emptyToUndefined, z.string().optional()), // e.g. http://localhost:8888 ; unset = Hindsight disabled (local ledger only)
  HINDSIGHT_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  HINDSIGHT_BANK_ID: z.string().default('bmw-operations'),
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
  ai: {
    provider: env.LLM_PROVIDER,
    model:
      env.LLM_MODEL ?? (env.LLM_PROVIDER === 'anthropic' ? 'claude-haiku-4-5-20251001' : env.LLM_PROVIDER === 'openai' ? 'gpt-4o-mini' : ''),
    apiKey: env.LLM_API_KEY,
    baseUrl: env.LLM_BASE_URL ?? (env.LLM_PROVIDER === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'),
    maxTokens: env.LLM_MAX_TOKENS,
    timeoutMs: env.AI_TIMEOUT_MS,
    rateLimitMax: env.AI_RATE_LIMIT_MAX,
    hindsightUrl: env.HINDSIGHT_URL?.replace(/\/$/, ''),
    hindsightApiKey: env.HINDSIGHT_API_KEY,
    hindsightBank: env.HINDSIGHT_BANK_ID,
  },
  rateLimit: {
    windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
    max: env.RATE_LIMIT_MAX,
    loginMax: env.LOGIN_RATE_LIMIT_MAX,
  },
};
