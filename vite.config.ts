import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

/** Dev server port — must match connect-src / ws: in dev CSP below. */
const DEV_SERVER_PORT = 5173

/**
 * Injects <meta http-equiv="Content-Security-Policy"> per Electron security tutorial.
 * @see https://www.electronjs.org/docs/latest/tutorial/security
 */
function electronCspMetaPlugin(): Plugin {
  const devCsp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' http://127.0.0.1:${DEV_SERVER_PORT} http://localhost:${DEV_SERVER_PORT} ws://127.0.0.1:${DEV_SERVER_PORT} ws://localhost:${DEV_SERVER_PORT}`,
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "worker-src 'none'",
  ].join('; ')

  const prodCsp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self'",
    "connect-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "worker-src 'none'",
  ].join('; ')

  return {
    name: 'electron-csp-meta',
    transformIndexHtml(html, ctx) {
      const csp = ctx.server ? devCsp : prodCsp
      const tag = `    <meta http-equiv="Content-Security-Policy" content="${csp}" />\n`
      return html.replace('<head>', `<head>\n${tag}`)
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  server: {
    port: DEV_SERVER_PORT,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('react-dom')) return 'react-dom';
          if (id.includes('/react/') || id.includes('\\react\\')) return 'react';
          if (id.includes('lucide-react')) return 'lucide';
          return 'vendor';
        },
      },
    },
  },
  plugins: [
    electronCspMetaPlugin(),
    react(),
    electron({
      main: {
        entry: 'src/main/main.ts',
        vite: {
          build: {
            rollupOptions: {
              output: {
                inlineDynamicImports: false,
                chunkFileNames: 'main-[name].js',
                entryFileNames: 'main.js',
              },
            },
          },
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        input: 'src/main/preload.ts',
        vite: {
          build: {
            codeSplitting: false,
          },
        },
      },
    }),
  ],
  resolve: {
    tsconfigPaths: true,
  },
})

