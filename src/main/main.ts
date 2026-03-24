import { app, BrowserWindow, Menu, Tray } from 'electron';
import path from 'path';
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
  const [{ systemProxyService }, { xrayService }] = await Promise.all([
    import('./services/SystemProxyService'),
    import('./services/XrayService'),
  ]);
  await systemProxyService.disable();
  xrayService.stop();
}

/** Must match build.appId — Windows taskbar, jump lists, toasts. @see https://www.electron.build/nsis */
if (process.platform === 'win32') {
  app.setAppUserModelId('com.ultima.vless');
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', async () => {
    await ensureTray();
    await showMainWindow();
  });
}

async function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    await createWindow();
  }

  if (!mainWindow) return;

  mainWindow.setSkipTaskbar(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function hideMainWindow() {
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
        void showMainWindow();
      },
    },
    {
      label: 'Скрыть',
      click: () => hideMainWindow(),
    },
    { type: 'separator' },
    {
      label: 'Выход',
      click: async () => {
        isQuitting = true;
        await stopNetworkStack();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Common Windows behavior: click tray icon to toggle the window.
  tray.on('click', () => {
    void (async () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        await showMainWindow();
        return;
      }
      if (mainWindow.isVisible()) hideMainWindow();
      else await showMainWindow();
    })();
  });

  tray.on('double-click', () => {
    void showMainWindow();
  });
}

async function createWindow() {
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

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  mainWindow.on('close', (event) => {
    // On Windows/Linux we keep running in tray instead of quitting.
    if (isQuitting) return;
    event.preventDefault();
    hideMainWindow();
  });

  // Deny all popup windows from renderer content.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Prevent navigation away from trusted app content.
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const isDev = !!process.env.VITE_DEV_SERVER_URL;
    const allowPrefix = isDev
      ? process.env.VITE_DEV_SERVER_URL || ''
      : 'file://';
    if (!navigationUrl.startsWith(allowPrefix)) {
      event.preventDefault();
      logger.warn('Main', 'Blocked unexpected navigation', { navigationUrl });
    }
  });

  const { registerIpcHandlers, loadInitialState } = await import('./ipc/IpcHandler');
  registerIpcHandlers(mainWindow);

  mainWindow.webContents.once('did-finish-load', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      await loadInitialState(mainWindow);
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.on('ready', async () => {
  logger.info('Main', 'App ready');
  await createWindow();
  await ensureTray();
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

app.on('before-quit', async () => {
  if (!isQuitting) {
    isQuitting = true;
    await stopNetworkStack();
  }
});
