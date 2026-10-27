import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.mts';

/**
 * Tests run against the Android bundle's module graph: the same platform
 * overrides and Node shims as `vite.config.mts`, with the native plugin
 * replaced by an in-memory fake.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['test/setup.ts'],
      include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    },
  }),
);
