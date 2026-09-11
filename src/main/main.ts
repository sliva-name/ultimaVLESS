import { app, BrowserWindow, powerMonitor } from 'electron';
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
import { rotateFileSync } from './utils/logRotation';
import {
  activateRunningInstance,
  startInstanceActivationService,
  stopInstanceActivationService,
} from './runtime/instanceActivation';
import { appLifecycle, type QuitReason } from './runtime/appLifecycle';
import { isElevatedRelaunch } from './runtime/launchArgs';
import { startupRecovery } from './runtime/startupRecovery';
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

/**
 * Must match build.appId — Windows taskbar, jump lists, toasts.
 * Only for packaged builds: dev runs of electron.exe under the production
 * AUMID poison the shell icon cache (taskbar / Action Center) with the
 * default Electron icon. @see https://www.electron.build/nsis
 */
if (process.platform === 'win32' && app.isPackaged) {
  app.setAppUserModelId('com.ultima.vless');
}

// ---------------------------------------------------------------------------
// Process-wide state
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;
/** In-flight window creation; makes `createWindow()` idempotent. */
let windowCreation: Promise<BrowserWindow> | null = null;
let isQuitting = false;
let isShuttingDown = false;
/** Set when electron-updater is driving the quit; before-quit must not intercept it. */
let isQuittingForUpdate = false;
/** Full initial load (subscription refresh, timers) must run once per app session. */
let initialStateLoadedOnce = false;
/**
 * True for the process that runs the app (owns the single-instance lock, or is
 * the elevated replacement of an instance that is quitting). Duplicate
 * launches stay `false` and must never touch the shared network state.
 */
let isPrimaryInstance = false;
const startupPerfOriginMs = performance.now();
const SHUTDOWN_TIMEOUT_MS = 15000;
/** Delay non-critical background work until after the first window paint. */
const DEFERRED_STARTUP_WORK_MS = 1500;
/**
 * The instance we replace releases its single-instance lock right after the
 * UAC prompt returns; an elevated replacement that boots faster must wait for
 * that instead of treating the predecessor as "the running app".
 */
const RELAUNCH_LOCK_WAIT_MS = 8000;
const RELAUNCH_LOCK_RETRY_MS = 250;
const DID_FAIL_LOAD_ABORTED = -3;
const UNRESPONSIVE_RECOVERY_DELAY_MS = 4000;
const FATAL_EXIT_DELAY_MS = 1500;
let unresponsiveRecoveryTimer: NodeJS.Timeout | null = null;
let deferredStartupWorkScheduled = false;
let deferredStartupWorkTimer: NodeJS.Timeout | null = null;
let fatalExitTimer: NodeJS.Timeout | null = null;

const userDataDir = app.getPath('userData');
const relaunchedElevated = isElevatedRelaunch();

function logStartupStep(step: string, data?: Record<string, unknown>) {
  logger.info('Startup', step, {
    elapsedMs: Math.round(performance.now() - startupPerfOriginMs),
    ...data,
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

// ---------------------------------------------------------------------------
// Network stack helpers
// ---------------------------------------------------------------------------

async function stopNetworkStack(): Promise<void> {
  const { connectionManager } =
    await import('./domain/connection/ConnectionManager');
  // Preserve pending TUN reconnect across quit — required when we relaunch
  // elevated after UAC so the new process can resume the connection.
  await connectionManager.disconnect({
    preservePendingTunReconnect: true,
  });
}

/**
 * Undoes what a crashed or killed session left behind (system proxy on, TUN
 * routes pinned). Runs in the background once the window is up; anything that
 * mutates the network stack waits on `startupRecovery` before proceeding.
 */
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
    logStartupStep('Orphaned network state recovery finished', {
      durationMs: recoveryTimer.end(),
    });
  }
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
        const { connectionMonitorService } =
          await import('./services/ConnectionMonitorService');
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

/**
 * Opens this session's log files: the previous `app.log` / `xray.log` become
 * `.1` backups instead of being truncated at shutdown, so a post-mortem of the
 * last session is always possible and an elevated relaunch never wipes the
 * file its replacement is already writing to.
 */
function beginSessionLogs(): void {
  logger.beginSession();
  try {
    rotateFileSync(path.join(userDataDir, 'xray.log'), 1);
  } catch (error) {
    logger.warn('Main', 'Failed to rotate xray.log for the new session', error);
  }
}

// ---------------------------------------------------------------------------
// Window management
// ---------------------------------------------------------------------------

async function showMainWindow(reason: string = 'unspecified') {
  if (isShuttingDown) {
    logStartupStep('showMainWindow ignored during shutdown', { reason });
    return;
  }
  logStartupStep('showMainWindow called', { reason });
  const window = await createWindow();
  if (window.isDestroyed()) return;

  window.setSkipTaskbar(false);
  if (window.isMinimized()) window.restore();
  window.show();
  // Raise above other windows even when Windows denies foreground focus.
  window.moveTop();
  window.focus();

  // Windows refuses foreground activation to a process that does not own the
  // current foreground window, so a tray/shortcut click can leave the window
  // visible but buried. A brief always-on-top bump is the documented way out.
  if (process.platform === 'win32') {
    window.setAlwaysOnTop(true);
    window.setAlwaysOnTop(false);
    window.focus();
    if (!window.isFocused()) {
      window.flashFrame(true);
    }
  }
}

function hideMainWindow(reason: string = 'unspecified') {
  logStartupStep('hideMainWindow called', { reason });
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.hide();
  mainWindow.setSkipTaskbar(true);
}

function clearUnresponsiveRecoveryTimer(): void {
  if (!unresponsiveRecoveryTimer) {
    return;
  }
  clearTimeout(unresponsiveRecoveryTimer);
  unresponsiveRecoveryTimer = null;
}

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
  void logger.flush().catch(() => undefined);

  // Guard against overlapping timers that would otherwise call
  // app.exit(1) more than once.
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

async function ensureTray() {
  trayService.init(
    {
      onShow: () => {
        void showMainWindow('tray-menu-show');
      },
      onHide: () => hideMainWindow('tray-menu-hide'),
      onQuit: () => appLifecycle.requestQuit('user'),
      isWindowVisible: () =>
        !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible(),
      isWindowFocused: () =>
        !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused(),
    },
    () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
  );
  logStartupStep('Tray initialized');
}

async function resendStateToRenderer(window: BrowserWindow): Promise<void> {
  const { pushAppSnapshot } = await import('./ipc/IpcHandler');
  if (!window.isDestroyed()) {
    pushAppSnapshot('bootstrap');
  }
}

/**
 * Returns the live main window, creating it when needed. Concurrent callers
 * (startup, a tray click, an activation request from a second launch) share
 * one creation, so the app can never end up with two windows.
 */
function createWindow(): Promise<BrowserWindow> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return Promise.resolve(mainWindow);
  }
  windowCreation ??= buildWindow().finally(() => {
    windowCreation = null;
  });
  return windowCreation;
}

async function buildWindow(): Promise<BrowserWindow> {
  const windowCreateStartedAt = performance.now();
  logger.info('Main', 'createWindow called');

  const windowInstance = new BrowserWindow({
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
  mainWindow = windowInstance;
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

  windowInstance.on('show', () => {
    logStartupStep('Main window show event');
  });
  windowInstance.on('hide', () => {
    logStartupStep('Main window hide event');
  });
  windowInstance.on('focus', () => {
    logStartupStep('Main window focus event');
  });
  windowInstance.on('closed', () => {
    if (mainWindow === windowInstance) {
      mainWindow = null;
    }
  });

  windowInstance.once('ready-to-show', () => {
    if (mainWindow === windowInstance && !windowInstance.isDestroyed()) {
      // A quit that started before first paint (e.g. an elevated relaunch)
      // must keep the window hidden.
      if (!isShuttingDown) {
        windowInstance.show();
      }
      logStartupStep('Main window ready-to-show');
      scheduleDeferredStartupWork();
    }
  });

  windowInstance.on('close', (event) => {
    // On Windows/Linux we keep running in tray instead of quitting.
    if (isQuitting) return;
    event.preventDefault();
    hideMainWindow('window-close');
  });

  // Deny all popup windows from renderer content.
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Prevent navigation away from trusted app content.
  wc.on('will-navigate', (event, navigationUrl) => {
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
  registerIpcHandlers(windowInstance);

  wc.on('did-finish-load', async () => {
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
        logger.error(
          'Main',
          'Failed to load state after did-finish-load',
          error,
        );
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
  return windowInstance;
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

/**
 * Electron's single-instance lock is exclusive per user-data directory. The
 * process we replace during an elevated relaunch gives its lock up as soon as
 * the UAC prompt returns, but the replacement may reach this point first —
 * poll briefly instead of mistaking the dying predecessor for the primary.
 */
async function acquireSingleInstanceLock(): Promise<boolean> {
  if (app.requestSingleInstanceLock()) {
    return true;
  }
  if (!relaunchedElevated) {
    return false;
  }
  const deadline = Date.now() + RELAUNCH_LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    await delay(RELAUNCH_LOCK_RETRY_MS);
    if (app.requestSingleInstanceLock()) {
      logStartupStep('Acquired single-instance lock from the predecessor');
      return true;
    }
  }
  // The predecessor started us and is on its way out; it cannot be "the
  // running app" to hand over to. Boot anyway — the filesystem activation
  // handshake keeps later launches reaching this instance even without the
  // Electron lock.
  logger.warn(
    'Main',
    'Predecessor did not release the single-instance lock in time; booting as primary',
    { waitedMs: RELAUNCH_LOCK_WAIT_MS },
  );
  return true;
}

/**
 * A desktop-shortcut / Start-Menu launch while the tray instance is running.
 * Electron is supposed to emit `second-instance` on the primary, but on
 * Windows that IPC is unreliable (and UIPI blocks it entirely when the primary
 * is elevated for TUN). Ask the primary over the filesystem handshake instead.
 *
 * Uses app.exit — never app.quit. `before-quit` on THIS process would tear
 * down the primary's system proxy / TUN routes.
 */
async function exitAsDuplicateLaunch(): Promise<void> {
  try {
    await activateRunningInstance(userDataDir);
  } catch (error) {
    logger.error('Main', 'Failed to activate the running instance', error);
  }
  await logger.flush().catch(() => undefined);
  app.exit(0);
}

async function handleActivationRequest(reason: string): Promise<void> {
  if (isShuttingDown || appLifecycle.quitReason !== null) {
    logStartupStep('Activation request ignored during shutdown', { reason });
    return;
  }
  if (!app.isReady()) {
    // Tray and window cannot exist yet; bootstrap creates both in a moment.
    logStartupStep('Activation request ignored before ready', { reason });
    return;
  }
  try {
    await ensureTray();
    await showMainWindow(reason);
  } catch (error) {
    logger.error('Main', `Failed to handle ${reason}`, error);
  }
}

async function bootstrap(): Promise<void> {
  isPrimaryInstance = await acquireSingleInstanceLock();
  if (!isPrimaryInstance) {
    await exitAsDuplicateLaunch();
    return;
  }

  app.on('second-instance', () => {
    void handleActivationRequest('second-instance');
  });

  await app.whenReady();

  // Holding the lock does not prove we are alone: UIPI hides an elevated
  // instance (TUN mode runs elevated) from this process, so ask over the
  // filesystem handshake before booting a duplicate app.
  if (!relaunchedElevated && (await activateRunningInstance(userDataDir))) {
    logStartupStep('Handed activation to the running instance');
    // Exit instead of quit: `before-quit` would tear down the *shared* network
    // state (system proxy, TUN routes) that the other instance still owns.
    await logger.flush().catch(() => undefined);
    app.exit(0);
    return;
  }

  // From here on this process is the app.
  startInstanceActivationService(userDataDir, () => {
    void handleActivationRequest('activation-request');
  });
  beginSessionLogs();
  initMainSentry();
  logStartupStep('App ready event', { relaunchedElevated });
  registerPowerMonitor();

  // Recovery of a crashed session's network state runs in the background and
  // never delays the window. It is started before the window so the gate is
  // armed by the time the renderer's did-finish-load kicks off a pending TUN
  // resume; connect paths wait on `startupRecovery` before touching the stack.
  void startupRecovery.run(recoverOrphanedNetworkState);

  // Window and tray next: the user gets feedback immediately, and a second
  // launch during startup finds a window to raise instead of creating one.
  await createWindow();
  logStartupStep('createWindow finished');
  await ensureTray();
  logStartupStep('ensureTray finished');
  // loadInitialState runs from did-finish-load so the renderer has subscribed to
  // app snapshots; calling it here as well duplicated refresh/ping work and
  // caused overlapping ping-all-servers requests to be discarded as stale.
}

void bootstrap().catch((error) => {
  logger.error('Main', 'Bootstrap failed', error);
  scheduleFatalExit('uncaught-exception', error);
});

// ---------------------------------------------------------------------------
// Fault handling
// ---------------------------------------------------------------------------

process.on('uncaughtException', (error) => {
  scheduleFatalExit('uncaught-exception', error);
});

process.on('unhandledRejection', (reason) => {
  // A rejected promise in async glue is a bug to report, not a reason to take
  // the user's VPN down: the network stack is still consistent. Sentry's
  // main-process integration captures these as well.
  logger.error('Main', 'Unhandled promise rejection', {
    reason: formatUnknownError(reason),
  });
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
  // Keep the app running in the tray on Windows/Linux. A close during an
  // in-flight shutdown must not short-circuit it — `before-quit` below keeps
  // blocking until performShutdown() has finished.
  if (process.platform === 'darwin') {
    appLifecycle.requestQuit('user');
  }
});

app.on('activate', async () => {
  try {
    await createWindow();
    await ensureTray();
  } catch (error) {
    logger.error('Main', 'Failed to handle activate', error);
  }
});

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

async function performShutdown(reason: QuitReason): Promise<void> {
  // The window must not stay interactive (or closable) while PowerShell is
  // restoring the network stack.
  hideMainWindow(`shutdown:${reason}`);
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
    const { stopAllSubscriptionAutoRefreshTimers } =
      await import('./ipc/subscriptionRefresh');
    stopAllSubscriptionAutoRefreshTimers();
  } catch (error) {
    logger.warn(
      'Main',
      'Failed to stop subscription auto-refresh timers',
      error,
    );
  }
  appUpdaterService.dispose();
  trayService.dispose();
  // During an elevated relaunch the replacement already publishes its own
  // heartbeat; deleting the owner record would hide it from later launches.
  stopInstanceActivationService(userDataDir, {
    removeOwnerRecord: reason !== 'elevated-relaunch',
  });
  await logger.flush();
}

function beginShutdown(reason: QuitReason): void {
  isQuitting = true;
  isShuttingDown = true;
  logStartupStep('Shutdown started', { reason });

  const forceExitTimeout = setTimeout(() => {
    logger.warn('Main', 'Forced exit after shutdown timeout', {
      timeoutMs: SHUTDOWN_TIMEOUT_MS,
    });
    app.exit(0);
  }, SHUTDOWN_TIMEOUT_MS);

  void (async () => {
    try {
      await performShutdown(reason);
    } catch (error) {
      logger.error('Main', 'Shutdown failed; exiting anyway', error);
    }
    clearTimeout(forceExitTimeout);
    // Mirror autoInstallOnAppQuit: app.exit() would skip the updater's quit
    // hook, so explicitly install the downloaded update. Not during a relaunch
    // — the installer would fight the elevated instance that just started.
    if (
      reason !== 'elevated-relaunch' &&
      appUpdaterService.hasDownloadedUpdate()
    ) {
      isQuittingForUpdate = true;
      if (appUpdaterService.installDownloadedUpdate()) {
        return;
      }
    }
    app.exit(0);
  })();
}

appLifecycle.on('quit-requested', (reason) => {
  if (reason !== 'elevated-relaunch') {
    return;
  }
  logStartupStep('Handing over to the elevated instance');
  // The replacement is already starting: get out of its way at once. The
  // window disappears instead of sitting on screen with a stale "connecting"
  // state, the heartbeat stops so a late tick cannot overwrite the new owner
  // record, and the single-instance lock is released for the new process.
  hideMainWindow('elevated-relaunch');
  stopInstanceActivationService(userDataDir, { removeOwnerRecord: false });
  app.releaseSingleInstanceLock();
});

app.on('before-quit', (event) => {
  // A duplicate launch that lost the single-instance race must not tear down
  // the primary's VPN (system proxy / TUN routes are process-global).
  if (!isPrimaryInstance) return;
  // When electron-updater drives the quit (quitAndInstall), our shutdown has
  // already run via the prepare-for-quit hook; do not intercept the quit or
  // the downloaded update would never be installed.
  if (isQuittingForUpdate) return;
  if (isShuttingDown) {
    // Another quit signal (closing the window mid-shutdown, a second tray
    // click) must not let Electron exit before the network stack is restored;
    // performShutdown() ends the process itself.
    event.preventDefault();
    return;
  }

  event.preventDefault();
  // OS session end or a direct app.quit() arrives without a recorded reason.
  appLifecycle.noteExternalQuit('user');
  beginShutdown(appLifecycle.quitReason ?? 'user');
});

// IPC install-update: gracefully tear down the network stack with the same
// procedure as before-quit, then let electron-updater quit and install.
appUpdaterService.setPrepareForQuit(async () => {
  if (isShuttingDown) return;
  isQuitting = true;
  isShuttingDown = true;
  isQuittingForUpdate = true;
  appLifecycle.noteExternalQuit('update');
  await performShutdown('update');
});
