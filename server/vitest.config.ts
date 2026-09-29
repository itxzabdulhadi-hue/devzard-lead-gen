import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./src/test/globalSetup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://devzard:devzard@localhost:5433/devzard_test',
      JWT_SECRET: 'test-secret-for-vitest-only-0123456789',
      DEVZARD_ADMIN_EMAIL: 'test-admin@devzard.test',
      DEVZARD_ADMIN_PASSWORD: 'test-admin-pass',
      ANALYSIS_ALLOW_PRIVATE_HOSTS: 'true',
      ANALYSIS_CONCURRENCY: '3',
      ANALYSIS_DELAY_MS: '10',
      ANALYSIS_PER_HOST_DELAY_MS: '10',
    },
  },
});
