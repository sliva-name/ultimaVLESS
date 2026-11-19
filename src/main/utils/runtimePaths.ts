import path from 'path';
import { app, nativeImage, type NativeImage } from 'electron';

export function getBinResourcesPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(process.cwd(), 'resources/bin');
}

export function getAppIconPath(
  platform: NodeJS.Platform = process.platform,
): string {
  const resourcesPath = getBinResourcesPath();
  if (platform === 'win32') {
    return path.join(resourcesPath, 'logo.ico');
  }
  // Electron's nativeImage cannot decode multi-layer .icns containers —
  // passing one to Tray/BrowserWindow yields an empty image and Tray throws,
  // which the fatal-error handler turns into app.exit(1). The .icns is still
  // shipped for electron-builder (build.mac.icon); runtime uses the PNG.
  return path.join(resourcesPath, 'logo-256x256.png');
}

const TRAY_ICON_SIZE = 18;

/**
 * Tray icon for the platform menu bar / notification area.
 *
 * On macOS a Tray must be a small NativeImage: the 256px PNG would render
 * huge in NSStatusBar, and .icns is undecodable. Two representations (1x/2x)
 * keep the icon sharp on Retina displays.
 */
export function getTrayIcon(
  platform: NodeJS.Platform = process.platform,
): NativeImage | string {
  const iconPath = getAppIconPath(platform);
  if (platform !== 'darwin') {
    return iconPath;
  }
  const source = nativeImage.createFromPath(iconPath);
  const trayIcon = nativeImage.createEmpty();
  for (const scaleFactor of [1, 2] as const) {
    const size = TRAY_ICON_SIZE * scaleFactor;
    trayIcon.addRepresentation({
      scaleFactor,
      width: size,
      height: size,
      buffer: source.resize({ width: size, height: size }).toPNG(),
    });
  }
  return trayIcon;
}

/**
 * Windows toast notifications only render PNG/JPEG/GIF images — `.ico` is
 * silently dropped by the Toast API, so notifications must use the PNG.
 */
export function getNotificationIconPath(): string {
  return path.join(getBinResourcesPath(), 'logo-256x256.png');
}

export function getRendererEntryPath(): string {
  return path.join(__dirname, '../../dist/index.html');
}
