import { defineConfig } from 'vitest/config';

const testDb = process.env.TEST_DATABASE_URL ?? 'postgres://bmw:bmw_dev_password@localhost:5440/bmw_test';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    setupFiles: ['tests/setup.ts'],
    fileParallelism: false, // all files share one test database
    testTimeout: 20000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: process.env.JWT_SECRET ?? 'test-secret-test-secret-test-secret-1234',
      DATABASE_URL: testDb,
      TEST_DATABASE_URL: testDb,
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6390',
      LOGIN_RATE_LIMIT_MAX: '1000',
      RATE_LIMIT_MAX: '100000',
    },
  },
});
