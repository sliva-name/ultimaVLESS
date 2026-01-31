import { app, BrowserWindow, Menu, Tray } from 'electron';
import path from 'path';
import { registerIpcHandlers, loadInitialState } from './ipc/IpcHandler';
import { xrayService } from './services/XrayService';
import { logger } from './services/LoggerService';
import { systemProxyService } from './services/SystemProxyService';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', async () => {
    await ensureTray();
    showMainWindow();
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
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
      click: () => showMainWindow(),
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
        // Отключаем прокси перед выходом
        await systemProxyService.disable();
        xrayService.stop();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Common Windows behavior: click tray icon to toggle the window.
  tray.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      showMainWindow();
      return;
    }

    if (mainWindow.isVisible()) hideMainWindow();
    else showMainWindow();
  });

  tray.on('double-click', () => showMainWindow());
}

function createWindow() {
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
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: 'hidden', 
    titleBarOverlay: {
      color: '#1e1e1e',
      symbolColor: '#ffffff'
    }
  });

  mainWindow.on('close', (event) => {
    // On Windows/Linux we keep running in tray instead of quitting.
    if (isQuitting) return;
    event.preventDefault();
    hideMainWindow();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    // In production, the renderer files are in the 'dist' folder
    // main.js is in 'dist-electron', so we go up one level and into 'dist'
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Open the DevTools.
  // mainWindow.webContents.openDevTools();

  // Register IPC handlers
  registerIpcHandlers(mainWindow);

  // Send initial state when page finishes loading (including reloads)
  mainWindow.webContents.once('did-finish-load', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      await loadInitialState(mainWindow);
    }
  });
}

app.on('ready', async () => {
  logger.info('Main', 'App ready');
  createWindow();
  await ensureTray();
  
  if (mainWindow) {
      await loadInitialState(mainWindow);
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

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
  void ensureTray();
});

app.on('before-quit', async () => {
  if (!isQuitting) {
    isQuitting = true;
    await systemProxyService.disable();
    xrayService.stop();
  }
});
