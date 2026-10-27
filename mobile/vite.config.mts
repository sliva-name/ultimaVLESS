import type { Plugin } from 'vite';
import { defineConfig, normalizePath } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const mobileDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(mobileDir, '..');
const desktopSrc = path.join(repoDir, 'src');
const mobileSrc = path.join(mobileDir, 'src');

const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8'),
) as { version: string };

/**
 * Desktop main-process modules that talk to the operating system, and their
 * Android implementations. Everything else under `src/main` runs unchanged.
 */
const PLATFORM_OVERRIDES: Record<string, string> = {
  'main/infrastructure/persistence/appStore.ts': 'platform/appStore.ts',
  'main/services/AppUpdaterService.ts': 'platform/AppUpdaterService.ts',
  'main/services/ConflictingAppsService.ts':
    'platform/ConflictingAppsService.ts',
  'main/services/LogExportService.ts': 'platform/LogExportService.ts',
  'main/services/LoggerService.ts': 'platform/LoggerService.ts',
  'main/services/PrivilegeService.ts': 'platform/PrivilegeService.ts',
  'main/services/RealDelayService.ts': 'platform/RealDelayService.ts',
  'main/services/SystemProxyService.ts': 'platform/SystemProxyService.ts',
  'main/services/TrafficStatsService.ts': 'platform/TrafficStatsService.ts',
  'main/services/TrayService.ts': 'platform/TrayService.ts',
  'main/services/TunRouteService.ts': 'platform/TunRouteService.ts',
  'main/services/XrayService.ts': 'platform/XrayService.ts',
  'main/services/connectionMonitor/xrayLogCursor.ts':
    'platform/xrayLogCursor.ts',
  'main/services/runningApps.ts': 'platform/runningApps.ts',
};

/** Node built-ins and Electron, as the slices the main process uses. */
const MODULE_SHIMS: Record<string, string> = {
  child_process: 'node/child_process.ts',
  crypto: 'node/crypto.ts',
  dns: 'node/dns.ts',
  electron: 'electron/index.ts',
  'electron-store': 'electron/electronStore.ts',
  events: 'node/events.ts',
  fs: 'node/fs.ts',
  http: 'node/http.ts',
  net: 'node/net.ts',
  os: 'node/os.ts',
  path: 'node/path.ts',
  tls: 'node/tls.ts',
};

function normalizeId(id: string): string {
  return path.resolve(id.split('?')[0]).toLowerCase();
}

// Replacement ids use the bundler's own spelling (forward slashes): a
// Windows-style path would be a second instance of the same module.
const overrideById = new Map(
  Object.entries(PLATFORM_OVERRIDES).map(([desktop, mobile]) => [
    normalizeId(path.join(desktopSrc, desktop)),
    normalizePath(path.join(mobileSrc, mobile)),
  ]),
);

/**
 * Swaps platform modules by their resolved file, so relative imports inside
 * `src/main` (`./XrayService`) are caught as well as `@/` ones. The Android
 * modules reach the desktop originals they build on through `@desktop/`.
 */
function androidPlatformPlugin(): Plugin {
  return {
    name: 'ultima-android-platform',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source.startsWith('@desktop/')) {
        return this.resolve(
          path.join(desktopSrc, source.slice('@desktop/'.length)),
          importer,
          { ...options, skipSelf: true },
        );
      }
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      if (!resolved) return null;
      const replacement = overrideById.get(normalizeId(resolved.id));
      return replacement ?? resolved;
    },
  };
}

/** Same CSP as the packaged desktop renderer: the UI loads nothing remote. */
function cspMetaPlugin(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "worker-src 'none'",
  ].join('; ');
  return {
    name: 'ultima-mobile-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
  };
}

export default defineConfig({
  root: mobileDir,
  base: './',
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageJson.version),
    'import.meta.env.VITE_TARGET': JSON.stringify('android'),
  },
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${desktopSrc}/` },
      ...Object.entries(MODULE_SHIMS).map(([name, file]) => ({
        find: new RegExp(`^(node:)?${name}$`),
        replacement: normalizePath(path.join(mobileSrc, file)),
      })),
    ],
    dedupe: ['react', 'react-dom', 'i18next', 'react-i18next'],
  },
  css: {
    postcss: { plugins: [tailwindcss()] },
  },
  plugins: [androidPlatformPlugin(), cspMetaPlugin(), react()],
  server: {
    port: 5174,
    strictPort: true,
    fs: { allow: [repoDir] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome110',
    chunkSizeWarningLimit: 2000,
  },
});
