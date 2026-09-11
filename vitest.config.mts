import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const srcDir = path.resolve(process.cwd(), 'src');
const resolveAliases = {
  resolve: {
    alias: { '@': srcDir },
    tsconfigPaths: true,
  },
};

export default defineConfig({
  plugins: [react()],
  ...resolveAliases,
  test: {
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    projects: [
      {
        ...resolveAliases,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/renderer/**/*.test.ts'],
        },
      },
      {
        ...resolveAliases,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: [
            'src/renderer/**/*.test.ts',
            'src/renderer/**/*.test.tsx',
            'src/test/domain/**/*.test.tsx',
          ],
        },
      },
    ],
  },
});
