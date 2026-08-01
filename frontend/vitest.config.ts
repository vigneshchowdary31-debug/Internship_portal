import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'dist'],
    // The pure logic under test (PDF assembly, filename derivation) needs no
    // DOM. Keeping the environment as node avoids pulling in jsdom for tests
    // that would not benefit from it.
    environment: 'node',
  },
});
