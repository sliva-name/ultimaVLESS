import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [
      ['**/src/renderer/**/*.test.ts', 'jsdom'],
      ['**/src/renderer/**/*.test.tsx', 'jsdom'],
    ],
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
  // Vite >= 7.1 resolves tsconfig `paths` natively. Vitest inherits this.
  resolve: {
    tsconfigPaths: true,
  },
});

