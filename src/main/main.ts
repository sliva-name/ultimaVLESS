import { app, BrowserWindow, Menu, Tray } from 'electron';
import { performance } from 'perf_hooks';
import path from 'path';
import { pathToFileURL } from 'url';
import { logger } from './services/LoggerService';
import { appRecoveryService } from './services/AppRecoveryService';
import { initMainSentry } from './services/SentryService';
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
      '  npx electron --trace-deprecation .'
  );
  process.exit(1);
}

async function stopNetworkStack(): Promise<void> {
  const [{ connectionStackService }, { connectionMonitorService }] = await Promise.all([
    import('./services/ConnectionStackService'),
    import('./services/ConnectionMonitorService'),
  ]);
  connectionMonitorService.stopMonitoring();
  await connectionStackService.resetNetworkingStack({ stopXray: true });
}

/** Must match build.appId — Windows taskbar, jump lists, toasts. @see https://www.electron.build/nsis */
if (process.platform === 'win32') {
  app.setAppUserModelId('com.ultima.vless');
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let isShuttingDown = false;
const startupPerfOriginMs = performance.now();
const SHUTDOWN_TIMEOUT_MS = 15000;
const DID_FAIL_LOAD_ABORTED = -3;
const UNRESPONSIVE_RECOVERY_DELAY_MS = 4000;
const FATAL_EXIT_DELAY_MS = 1500;
let unresponsiveRecoveryTimer: NodeJS.Timeout | null = null;

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
    await ensureTray();
    await showMainWindow('second-instance');
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
  } = {}
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
    logger.error('Main', 'Recovery attempt failed before renderer finished loading', error);
  }
}

function hideMainWindow(reason: string = 'unspecified') {
  logStartupStep('hideMainWindow called', { reason });
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.hide();
  mainWindow.setSkipTaskbar(true);
}

async function ensureTray() {
  if (tray) return;

  tray = new Tray(getAppIconPath(process.platform));
  tray.setToolTip('UltimaVLESS');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Показать',
      click: () => {
        void showMainWindow('tray-menu-show');
      },
    },
    {
      label: 'Скрыть',
      click: () => hideMainWindow('tray-menu-hide'),
    },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Common Windows behavior: click tray icon to toggle the window.
  tray.on('click', () => {
    void (async () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        await showMainWindow('tray-click-create-or-show');
        return;
      }
      if (mainWindow.isVisible()) hideMainWindow('tray-click-toggle-hide');
      else await showMainWindow('tray-click-toggle-show');
    })();
  });

  tray.on('double-click', () => {
    void showMainWindow('tray-double-click');
  });
  logStartupStep('Tray initialized');
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
      sandbox: true,
    },
    titleBarStyle: 'hidden', 
    titleBarOverlay: {
      color: '#1e1e1e',
      symbolColor: '#ffffff'
    }
  });
  const windowInstance = mainWindow;
  const wc = windowInstance.webContents;

  wc.on('did-start-loading', () => {
    logStartupStep('webContents did-start-loading');
  });
  wc.on('dom-ready', () => {
    logStartupStep('webContents dom-ready');
  });
  wc.on('did-stop-loading', () => {
    logStartupStep('webContents did-stop-loading');
  });
  wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    logStartupStep('webContents did-fail-load', {
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
    });
    if (!isMainFrame || errorCode === DID_FAIL_LOAD_ABORTED) {
      return;
    }
    void attemptWindowRecovery('did-fail-load', `did-fail-load:${errorCode}:${errorDescription}`, {
      details: {
        errorCode,
        errorDescription,
        validatedURL,
      },
    });
  });
  wc.on('render-process-gone', (_event, details) => {
    logStartupStep('webContents render-process-gone', {
      reason: details.reason,
      exitCode: details.exitCode,
    });
    void attemptWindowRecovery('render-process-gone', `render-process-gone:${details.reason}:${details.exitCode}`, {
      recreateWindow: true,
      details: {
        reason: details.reason,
        exitCode: details.exitCode,
      },
    });
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
        const expectedIndexUrl = pathToFileURL(path.join(__dirname, '../dist/index.html'));
        return (
          targetUrl.protocol === 'file:' &&
          decodeURIComponent(targetUrl.pathname) === decodeURIComponent(expectedIndexUrl.pathname)
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

  const { registerIpcHandlers, loadInitialState } = await import('./ipc/IpcHandler');
  registerIpcHandlers(mainWindow);

  mainWindow.webContents.on('did-finish-load', async () => {
    if (mainWindow === windowInstance && !windowInstance.isDestroyed()) {
      logStartupStep('Renderer did-finish-load');
      try {
        await loadInitialState(windowInstance);
        logStartupStep('Initial state loaded');
      } finally {
        appRecoveryService.completeRecovery();
      }
    }
  });

  void loadRenderer(windowInstance).catch((error) => {
    logger.error('Main', 'Initial renderer load failed', error);
    void attemptWindowRecovery('initial-load', `initial-load:${formatUnknownError(error)}`);
  });

  logStartupStep('BrowserWindow created', {
    createWindowMs: Math.round(performance.now() - windowCreateStartedAt),
  });
}

void app.whenReady().then(async () => {
  initMainSentry();
  logStartupStep('App ready event');
  await createWindow();
  logStartupStep('createWindow finished');
  await ensureTray();
  logStartupStep('ensureTray finished');
  // loadInitialState runs from did-finish-load so the renderer has subscribed to
  // update-servers; calling it here as well duplicated refresh/ping work and
  // caused overlapping ping-all-servers requests to be discarded as stale.
});

process.on('uncaughtException', (error) => {
  scheduleFatalExit('uncaught-exception', error);
});

process.on('unhandledRejection', (reason) => {
  scheduleFatalExit('unhandled-rejection', reason);
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
    void attemptWindowRecovery('child-process-gone', `child-process-gone:${details.type}:${details.reason}:${details.exitCode}`, {
      recreateWindow: details.type === 'GPU',
      details: {
        type: details.type,
        reason: details.reason,
        exitCode: details.exitCode,
      },
    });
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
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
  }
  await ensureTray();
});

app.on('before-quit', (event) => {
  if (isShuttingDown) return;

  event.preventDefault();
  isQuitting = true;
  isShuttingDown = true;

  const forceExitTimeout = setTimeout(() => {
    logger.warn('Main', 'Forced exit after shutdown timeout', { timeoutMs: SHUTDOWN_TIMEOUT_MS });
    app.exit(0);
  }, SHUTDOWN_TIMEOUT_MS);

  void (async () => {
    try {
      await stopNetworkStack();
    } catch (error) {
      logger.error('Main', 'Failed to stop network stack on quit', error);
    } finally {
      clearUnresponsiveRecoveryTimer();
      await logger.flush();
      clearTimeout(forceExitTimeout);
      app.exit(0);
    }
  })();
});
