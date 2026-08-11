import { app, BrowserWindow, powerMonitor } from 'electron';
import fs from 'fs/promises';
import { performance } from 'perf_hooks';
import path from 'path';
import { pathToFileURL } from 'url';
import { logger } from './services/LoggerService';
import { PerfTimer } from '@/shared/perfMetrics';
import { appRecoveryService } from './services/AppRecoveryService';
import { initMainSentry } from './services/SentryService';
import { trayService } from './services/TrayService';
import { appUpdaterService } from './services/AppUpdaterService';
import { getAppIconPath } from './utils/runtimePaths';
import type { AppRecoveryTrigger } from '@/shared/ipc';

if (!process.versions.electron) {
  // `node .` loads package.json "main" but `require("electron")` is not the real API outside Electron.
  // Node typings declare `process.versions.electron` as `string`, so use a falsy check
  // instead of `typeof`: when run under plain Node it's `undefined`.
  console.error(
    'Run this app with Electron, not Node:\n' +
      '  npx electron .\n' +
      '  npm run electron:start\n' +
      '  npx electron --trace-deprecation .',
  );
  process.exit(1);
}

async function stopNetworkStack(): Promise<void> {
  const { connectionController } = await import(
    './services/ConnectionController'
  );
  // Preserve pending TUN reconnect across quit — required when we relaunch
  // elevated after UAC so the new process can resume the connection.
  await connectionController.disconnect({
    preservePendingTunReconnect: true,
  });
}

let powerMonitorRegistered = false;

function registerPowerMonitor(): void {
  if (powerMonitorRegistered) {
    return;
  }
  powerMonitorRegistered = true;

  powerMonitor.on('suspend', () => {
    logger.info('Main', 'System is suspending');
  });

  // After waking from sleep the OS routinely tears down sockets and the tunnel,
  // but the periodic monitor may not tick for several more seconds. Force an
  // immediate health probe so a dead connection recovers (or auto-switches) fast.
  const onWake = (trigger: string) => {
    logger.info('Main', 'System resumed; forcing connection health check', {
      trigger,
    });
    void (async () => {
      // Re-pin TUN host routes first: after sleep the default gateway may have
      // changed, and probing over stale routes would misreport a dead tunnel.
      try {
        const { tunRouteService } = await import('./services/TunRouteService');
        await tunRouteService.reapplyRoutesAfterResume();
      } catch (error) {
        logger.warn('Main', 'Failed to reapply TUN routes after resume', error);
      }
      try {
        const { connectionMonitorService } = await import(
          './services/ConnectionMonitorService'
        );
        connectionMonitorService.triggerImmediateHealthCheck(trigger);
      } catch (error) {
        logger.warn('Main', 'Failed to handle resume health check', error);
      }
    })();
  };

  powerMonitor.on('resume', () => onWake('resume'));
  // Unlocking the screen can also follow a sleep/lid-open without a separate
  // 'resume' on some Windows configurations.
  powerMonitor.on('unlock-screen', () => onWake('unlock-screen'));
}

async function recoverOrphanedNetworkState(): Promise<void> {
  const recoveryTimer = new PerfTimer('Startup', 'recoverOrphanedNetworkState');
  try {
    const { systemProxyService } =
      await import('./services/SystemProxyService');
    if (await systemProxyService.recoverOrphanedState()) {
      logStartupStep('Recovered orphaned system proxy from previous session');
    }
  } catch (error) {
    logger.error(
      'Main',
      'Failed to recover orphaned system proxy on startup',
      error,
    );
  }
  try {
    const { tunRouteService } = await import('./services/TunRouteService');
    await tunRouteService.recoverOrphanedRoutes();
  } catch (error) {
    logger.error(
      'Main',
      'Failed to recover orphaned TUN routes on startup',
      error,
    );
  } finally {
    recoveryTimer.end();
  }
}

function scheduleDeferredStartupWork(): void {
  if (deferredStartupWorkScheduled) {
    return;
  }
  deferredStartupWorkScheduled = true;
  deferredStartupWorkTimer = setTimeout(() => {
    deferredStartupWorkTimer = null;
    logStartupStep('Running deferred startup work');
    void appUpdaterService.start().catch((error) => {
      logger.warn('Main', 'Auto-updater failed to start', error);
    });
  }, DEFERRED_STARTUP_WORK_MS);
}

async function truncateFileIfExists(filePath: string): Promise<void> {
  try {
    await fs.truncate(filePath, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

async function clearShutdownLogs(): Promise<void> {
  const xrayLogPath = path.join(app.getPath('userData'), 'xray.log');
  await Promise.all([truncateFileIfExists(xrayLogPath), logger.clear()]);
}

/**
 * Must match build.appId — Windows taskbar, jump lists, toasts.
 * Only for packaged builds: dev runs of electron.exe under the production
 * AUMID poison the shell icon cache (taskbar / Action Center) with the
 * default Electron icon. @see https://www.electron.build/nsis
 */
if (process.platform === 'win32' && app.isPackaged) {
  app.setAppUserModelId('com.ultima.vless');
}

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let isShuttingDown = false;
/** Set when electron-updater is driving the quit; before-quit must not intercept it. */
let isQuittingForUpdate = false;
/** Full initial load (subscription refresh, timers) must run once per app session. */
let initialStateLoadedOnce = false;
const startupPerfOriginMs = performance.now();
const SHUTDOWN_TIMEOUT_MS = 15000;
/** Delay non-critical background work until after the first window paint. */
const DEFERRED_STARTUP_WORK_MS = 1500;
const DID_FAIL_LOAD_ABORTED = -3;
const UNRESPONSIVE_RECOVERY_DELAY_MS = 4000;
const FATAL_EXIT_DELAY_MS = 1500;
let unresponsiveRecoveryTimer: NodeJS.Timeout | null = null;
let deferredStartupWorkScheduled = false;
let deferredStartupWorkTimer: NodeJS.Timeout | null = null;

function logStartupStep(step: string, data?: Record<string, unknown>) {
  logger.info('Startup', step, {
    elapsedMs: Math.round(performance.now() - startupPerfOriginMs),
    ...data,
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', async () => {
    try {
      await ensureTray();
      await showMainWindow('second-instance');
    } catch (error) {
      logger.error('Main', 'Failed to handle second-instance', error);
    }
  });
}

async function showMainWindow(reason: string = 'unspecified') {
  logStartupStep('showMainWindow called', { reason });
  if (!mainWindow || mainWindow.isDestroyed()) {
    logStartupStep('showMainWindow creating missing window', { reason });
    await createWindow();
  }

  if (!mainWindow) return;

  mainWindow.setSkipTaskbar(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

function clearUnresponsiveRecoveryTimer(): void {
  if (!unresponsiveRecoveryTimer) {
    return;
  }
  clearTimeout(unresponsiveRecoveryTimer);
  unresponsiveRecoveryTimer = null;
}

let fatalExitTimer: NodeJS.Timeout | null = null;

function scheduleFatalExit(trigger: AppRecoveryTrigger, error: unknown): void {
  if (isShuttingDown) {
    return;
  }

  const reason = formatUnknownError(error);
  const recoveryStatus = appRecoveryService.recordFatal(reason);
  logger.error('Main', 'Fatal runtime fault detected', {
    trigger,
    reason,
    recoveryAttemptCount: recoveryStatus.recoveryAttemptCount,
  });

  // Guard against overlapping timers that would otherwise call
  // app.exit(1) more than once (e.g. an uncaughtException followed by
  // an unhandledRejection in the same tick).
  if (fatalExitTimer) {
    return;
  }

  fatalExitTimer = setTimeout(() => {
    fatalExitTimer = null;
    if (!isShuttingDown) {
      isQuitting = true;
      // app.exit() skips before-quit, so tear the child down synchronously
      // before the process vanishes — otherwise xray (and its TUN routes /
      // bound ports) survive as an orphan.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require('./services/XrayService') as {
          xrayService?: { killSyncBestEffort?: () => void };
        };
        mod.xrayService?.killSyncBestEffort?.();
      } catch {
        // Module may not be loaded yet.
      }
      app.exit(1);
    }
  }, FATAL_EXIT_DELAY_MS);
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  if (process.env.VITE_DEV_SERVER_URL) {
    logStartupStep('Loading dev renderer URL');
    await window.loadURL(process.env.VITE_DEV_SERVER_URL);
    return;
  }

  logStartupStep('Loading packaged renderer file');
  await window.loadFile(path.join(__dirname, '../dist/index.html'));
}

async function attemptWindowRecovery(
  trigger: AppRecoveryTrigger,
  reason: string,
  options: {
    recreateWindow?: boolean;
    details?: Record<string, unknown>;
  } = {},
): Promise<void> {
  if (isQuitting || isShuttingDown) {
    return;
  }

  const recoveryStatus = appRecoveryService.beginRecovery(trigger, reason);
  if (recoveryStatus.recoveryBlocked) {
    logger.error('Main', 'Recovery suppressed after reaching retry limit', {
      trigger,
      reason,
      recoveryAttemptCount: recoveryStatus.recoveryAttemptCount,
      ...options.details,
    });
    return;
  }

  logger.warn('Main', 'Attempting bounded app recovery', {
    trigger,
    reason,
    recoveryAttemptCount: recoveryStatus.recoveryAttemptCount,
    recreateWindow: options.recreateWindow ?? false,
    ...options.details,
  });

  try {
    if (options.recreateWindow || !mainWindow || mainWindow.isDestroyed()) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.removeAllListeners('close');
        mainWindow.destroy();
      }
      mainWindow = null;
      await createWindow();
      appRecoveryService.completeRecovery('recreated');
      return;
    }

    await loadRenderer(mainWindow);
    appRecoveryService.completeRecovery('reloaded');
  } catch (error) {
    appRecoveryService.completeRecovery('completed');
    logger.error(
      'Main',
      'Recovery attempt failed before renderer finished loading',
      error,
    );
  }
}

function hideMainWindow(reason: string = 'unspecified') {
  logStartupStep('hideMainWindow called', { reason });
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.hide();
  mainWindow.setSkipTaskbar(true);
}

async function ensureTray() {
  trayService.init(
    {
      onShow: () => {
        void showMainWindow('tray-menu-show');
      },
      onHide: () => hideMainWindow('tray-menu-hide'),
      onQuit: () => {
        isQuitting = true;
        app.quit();
      },
      isWindowVisible: () =>
        !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible(),
    },
    () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
  );
  logStartupStep('Tray initialized');
}

async function resendStateToRenderer(window: BrowserWindow): Promise<void> {
  const [{ buildAppSnapshot }, { createIpcDependencies }, { IPC_EVENT_CHANNELS }] =
    await Promise.all([
      import('./ipc/appSnapshot'),
      import('./ipc/dependencies'),
      import('@/shared/ipc'),
    ]);
  if (!window.isDestroyed()) {
    window.webContents.send(
      IPC_EVENT_CHANNELS.appSnapshotChanged,
      buildAppSnapshot(createIpcDependencies()),
    );
  }
}

async function createWindow() {
  const windowCreateStartedAt = performance.now();
  logger.info('Main', 'createWindow called');

  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    backgroundColor: '#121212',
    icon: getAppIconPath(process.platform),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // The preload bundle exposes the typed Electron bridge via contextBridge.
      // Keeping Node integration off and context isolation on preserves the
      // renderer boundary; sandboxed preload breaks the bridge in dev/prod
      // because the bundled CJS preload relies on Electron's preload require.
      sandbox: false,
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1e1e1e',
      symbolColor: '#ffffff',
    },
  });
  const windowInstance = mainWindow;
  const wc = windowInstance.webContents;
  const rendererDebugEnabled =
    !!process.env.VITE_DEV_SERVER_URL ||
    process.env.ULTIMA_DEBUG_RENDERER === '1';

  // Electron 35+ moved the positional args into a single event object and
  // changed `level` from a number to a string ('info' | 'warning' | 'error' | 'debug').
  wc.on('console-message', ({ level, message, lineNumber, sourceId }) => {
    logger.info('RendererConsole', message, {
      level,
      line: lineNumber,
      sourceId,
    });
  });
  wc.on('preload-error', (_event, preloadPath, error) => {
    logger.error('Main', 'Preload script failed', {
      preloadPath,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  });
  if (rendererDebugEnabled) {
    wc.once('dom-ready', () => {
      if (!wc.isDestroyed()) {
        wc.openDevTools({ mode: 'detach' });
      }
    });
  }

  wc.on('did-start-loading', () => {
    logStartupStep('webContents did-start-loading');
  });
  wc.on('dom-ready', () => {
    logStartupStep('webContents dom-ready');
  });
  wc.on('did-stop-loading', () => {
    logStartupStep('webContents did-stop-loading');
  });
  wc.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      logStartupStep('webContents did-fail-load', {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
      });
      if (!isMainFrame || errorCode === DID_FAIL_LOAD_ABORTED) {
        return;
      }
      void attemptWindowRecovery(
        'did-fail-load',
        `did-fail-load:${errorCode}:${errorDescription}`,
        {
          details: {
            errorCode,
            errorDescription,
            validatedURL,
          },
        },
      );
    },
  );
  wc.on('render-process-gone', (_event, details) => {
    logStartupStep('webContents render-process-gone', {
      reason: details.reason,
      exitCode: details.exitCode,
    });
    void attemptWindowRecovery(
      'render-process-gone',
      `render-process-gone:${details.reason}:${details.exitCode}`,
      {
        recreateWindow: true,
        details: {
          reason: details.reason,
          exitCode: details.exitCode,
        },
      },
    );
  });
  wc.on('unresponsive', () => {
    logStartupStep('webContents unresponsive');
    clearUnresponsiveRecoveryTimer();
    unresponsiveRecoveryTimer = setTimeout(() => {
      void attemptWindowRecovery('unresponsive', 'webContents unresponsive', {
        recreateWindow: false,
      });
    }, UNRESPONSIVE_RECOVERY_DELAY_MS);
  });
  wc.on('responsive', () => {
    logStartupStep('webContents responsive');
    clearUnresponsiveRecoveryTimer();
  });

  mainWindow.on('show', () => {
    logStartupStep('Main window show event');
  });
  mainWindow.on('hide', () => {
    logStartupStep('Main window hide event');
  });
  mainWindow.on('focus', () => {
    logStartupStep('Main window focus event');
  });
  mainWindow.on('closed', () => {
    if (mainWindow === windowInstance) {
      mainWindow = null;
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      logStartupStep('Main window ready-to-show');
      scheduleDeferredStartupWork();
    }
  });

  mainWindow.on('close', (event) => {
    // On Windows/Linux we keep running in tray instead of quitting.
    if (isQuitting) return;
    event.preventDefault();
    hideMainWindow('window-close');
  });

  // Deny all popup windows from renderer content.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Prevent navigation away from trusted app content.
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    const isAllowed = (() => {
      if (devServerUrl) {
        try {
          const targetUrl = new URL(navigationUrl);
          const allowedDevUrl = new URL(devServerUrl);
          return targetUrl.origin === allowedDevUrl.origin;
        } catch {
          return false;
        }
      }

      try {
        const targetUrl = new URL(navigationUrl);
        const expectedIndexUrl = pathToFileURL(
          path.join(__dirname, '../dist/index.html'),
        );
        return (
          targetUrl.protocol === 'file:' &&
          decodeURIComponent(targetUrl.pathname) ===
            decodeURIComponent(expectedIndexUrl.pathname)
        );
      } catch {
        return false;
      }
    })();

    if (!isAllowed) {
      event.preventDefault();
      logger.warn('Main', 'Blocked unexpected navigation', { navigationUrl });
    }
  });

  const { registerIpcHandlers, loadInitialState } =
    await import('./ipc/IpcHandler');
  registerIpcHandlers(mainWindow);

  mainWindow.webContents.on('did-finish-load', async () => {
    if (mainWindow === windowInstance && !windowInstance.isDestroyed()) {
      logStartupStep('Renderer did-finish-load');
      try {
        if (!initialStateLoadedOnce) {
          initialStateLoadedOnce = true;
          await loadInitialState(windowInstance);
          logStartupStep('Initial state loaded');
        } else {
          // Window recovery / reload: only re-send current state to the
          // renderer; the full initial load (subscription refresh, timers)
          // already ran for this app session.
          await resendStateToRenderer(windowInstance);
          logStartupStep('State re-sent after reload');
        }
      } catch (error) {
        logger.error('Main', 'Failed to load state after did-finish-load', error);
      } finally {
        appRecoveryService.completeRecovery();
      }
    }
  });

  void loadRenderer(windowInstance).catch((error) => {
    logger.error('Main', 'Initial renderer load failed', error);
    void attemptWindowRecovery(
      'initial-load',
      `initial-load:${formatUnknownError(error)}`,
    );
  });

  logStartupStep('BrowserWindow created', {
    createWindowMs: Math.round(performance.now() - windowCreateStartedAt),
  });
}

void app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) {
    // A second instance must not initialize window/tray/IPC; app.quit()
    // has already been requested above.
    return;
  }
  initMainSentry();
  logStartupStep('App ready event');
  registerPowerMonitor();
  await recoverOrphanedNetworkState();
  await createWindow();
  logStartupStep('createWindow finished');
  await ensureTray();
  logStartupStep('ensureTray finished');
  // loadInitialState runs from did-finish-load so the renderer has subscribed to
  // app snapshots; calling it here as well duplicated refresh/ping work and
  // caused overlapping ping-all-servers requests to be discarded as stale.
});

process.on('uncaughtException', (error) => {
  scheduleFatalExit('uncaught-exception', error);
});

process.on('unhandledRejection', (reason) => {
  scheduleFatalExit('unhandled-rejection', reason);
});

// Last-resort sync kill if the process is exiting without going through
// before-quit (taskkill of the main process still won't hit this — Windows
// terminates the tree only when a job object is used — but Node exit hooks
// and app.exit paths that skip before-quit do).
process.on('exit', () => {
  try {
    // Dynamic import is async and useless here; require the already-loaded
    // singleton if the module graph has it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./services/XrayService') as {
      xrayService?: { killSyncBestEffort?: () => void };
    };
    mod.xrayService?.killSyncBestEffort?.();
  } catch {
    // Module may not be loaded yet during early startup failures.
  }
});

app.on('child-process-gone', (_event, details) => {
  logger.warn('Main', 'Child process gone', {
    type: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
    serviceName: details.serviceName,
    name: details.name,
  });

  if (details.type === 'Utility' || details.type === 'GPU') {
    void attemptWindowRecovery(
      'child-process-gone',
      `child-process-gone:${details.type}:${details.reason}:${details.exitCode}`,
      {
        recreateWindow: details.type === 'GPU',
        details: {
          type: details.type,
          reason: details.reason,
          exitCode: details.exitCode,
        },
      },
    );
  }
});

app.on('window-all-closed', () => {
  // Keep the app running in the tray on Windows/Linux.
  if (process.platform !== 'darwin') {
    if (isQuitting) {
      app.quit();
    }
  } else {
    app.quit();
  }
});

app.on('activate', async () => {
  try {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
    await ensureTray();
  } catch (error) {
    logger.error('Main', 'Failed to handle activate', error);
  }
});

async function performShutdown(): Promise<void> {
  try {
    await stopNetworkStack();
  } catch (error) {
    logger.error('Main', 'Failed to stop network stack on quit', error);
  }
  clearUnresponsiveRecoveryTimer();
  if (deferredStartupWorkTimer) {
    clearTimeout(deferredStartupWorkTimer);
    deferredStartupWorkTimer = null;
  }
  try {
    const { stopAllSubscriptionAutoRefreshTimers } = await import(
      './ipc/subscriptionRefresh'
    );
    stopAllSubscriptionAutoRefreshTimers();
  } catch (error) {
    logger.warn('Main', 'Failed to stop subscription auto-refresh timers', error);
  }
  appUpdaterService.dispose();
  trayService.dispose();
  await logger.flush();
  try {
    await clearShutdownLogs();
  } catch (error) {
    console.error('Failed to clear shutdown logs', error);
  }
}

app.on('before-quit', (event) => {
  // When electron-updater drives the quit (quitAndInstall), our shutdown has
  // already run via the prepare-for-quit hook; do not intercept the quit or
  // the downloaded update would never be installed.
  if (isQuittingForUpdate) return;
  if (isShuttingDown) return;

  event.preventDefault();
  isQuitting = true;
  isShuttingDown = true;

  const forceExitTimeout = setTimeout(() => {
    logger.warn('Main', 'Forced exit after shutdown timeout', {
      timeoutMs: SHUTDOWN_TIMEOUT_MS,
    });
    app.exit(0);
  }, SHUTDOWN_TIMEOUT_MS);

  void (async () => {
    try {
      await performShutdown();
    } catch (error) {
      logger.error('Main', 'Shutdown failed; exiting anyway', error);
    }
    clearTimeout(forceExitTimeout);
    if (appUpdaterService.hasDownloadedUpdate()) {
      // Mirror autoInstallOnAppQuit: app.exit() would skip the updater's
      // quit hook, so explicitly install the downloaded update. Its
      // internal app.quit() passes straight through (flag above).
      isQuittingForUpdate = true;
      if (appUpdaterService.installDownloadedUpdate()) {
        return;
      }
    }
    app.exit(0);
  })();
});

// IPC install-update: gracefully tear down the network stack with the same
// procedure as before-quit, then let electron-updater quit and install.
appUpdaterService.setPrepareForQuit(async () => {
  if (isShuttingDown) return;
  isQuitting = true;
  isShuttingDown = true;
  isQuittingForUpdate = true;
  await performShutdown();
});
