import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only source specs. Without this, vitest also discovers the compiled
    // copies under dist/, which are CommonJS and cannot import vitest.
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    environment: 'node',
    // jwt.ts throws at import time when JWT_SECRET is absent, so the suite
    // needs one. This value is test-only and never reaches any real signing.
    env: {
      JWT_SECRET: 'test-only-secret-not-used-outside-vitest',
      NODE_ENV: 'test',
    },
  },
});
