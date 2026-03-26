import { app, BrowserWindow, Menu, Tray } from 'electron';
import { performance } from 'perf_hooks';
import path from 'path';
import { pathToFileURL } from 'url';
import { logger } from './services/LoggerService';

if (typeof process.versions.electron !== 'string') {
  // `node .` loads package.json "main" but `require("electron")` is not the real API outside Electron.
  console.error(
    'Run this app with Electron, not Node:\n' +
      '  npx electron .\n' +
      '  npm run electron:start\n' +
      '  npx electron --trace-deprecation .'
  );
  process.exit(1);
}

async function stopNetworkStack(): Promise<void> {
  const [{ systemProxyService }, { xrayService }, { tunRouteService }, { connectionMonitorService }] = await Promise.all([
    import('./services/SystemProxyService'),
    import('./services/XrayService'),
    import('./services/TunRouteService'),
    import('./services/ConnectionMonitorService'),
  ]);
  connectionMonitorService.stopMonitoring();
  await systemProxyService.disable();
  await tunRouteService.disable();
  xrayService.stop();
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
const SHUTDOWN_TIMEOUT_MS = 5000;

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

function hideMainWindow(reason: string = 'unspecified') {
  logStartupStep('hideMainWindow called', { reason });
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.hide();
  mainWindow.setSkipTaskbar(true);
}

async function ensureTray() {
  if (tray) return;

  const resourcesPath = app.isPackaged 
    ? path.join(process.resourcesPath, 'bin')
    : path.join(__dirname, '../resources/bin');

  const iconPath = process.platform === 'win32'
    ? path.join(resourcesPath, 'logo.ico')
    : process.platform === 'darwin'
    ? path.join(resourcesPath, 'logo.icns')
    : path.join(resourcesPath, 'logo-256x256.png');

  tray = new Tray(iconPath);
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

  // Load icon for the window based on platform
  let iconPath: string | undefined;
  if (process.platform === 'win32') {
    iconPath = path.join(__dirname, '../resources/bin/logo.ico');
  } else if (process.platform === 'darwin') {
    iconPath = path.join(__dirname, '../resources/bin/logo.icns');
  } else {
    // Linux - use PNG
    iconPath = path.join(__dirname, '../resources/bin/logo-256x256.png');
  }
  
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    backgroundColor: '#121212',
    icon: iconPath,
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
  const wc = mainWindow.webContents;

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
  });
  wc.on('render-process-gone', (_event, details) => {
    logStartupStep('webContents render-process-gone', {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
  wc.on('unresponsive', () => {
    logStartupStep('webContents unresponsive');
  });
  wc.on('responsive', () => {
    logStartupStep('webContents responsive');
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

  mainWindow.webContents.once('did-finish-load', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      logStartupStep('Renderer did-finish-load');
      await loadInitialState(mainWindow);
      logStartupStep('Initial state loaded');
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    logStartupStep('Loading dev renderer URL');
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    logStartupStep('Loading packaged renderer file');
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  logStartupStep('BrowserWindow created', {
    createWindowMs: Math.round(performance.now() - windowCreateStartedAt),
  });
}

void app.whenReady().then(async () => {
  logStartupStep('App ready event');
  await createWindow();
  logStartupStep('createWindow finished');
  await ensureTray();
  logStartupStep('ensureTray finished');
  // loadInitialState runs from did-finish-load so the renderer has subscribed to
  // update-servers; calling it here as well duplicated refresh/ping work and
  // caused overlapping ping-all-servers requests to be discarded as stale.
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
      clearTimeout(forceExitTimeout);
      app.exit(0);
    }
  })();
});
