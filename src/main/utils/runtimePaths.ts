import path from 'path';
import { app } from 'electron';

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
  if (platform === 'darwin') {
    return path.join(resourcesPath, 'logo.icns');
  }
  return path.join(resourcesPath, 'logo-256x256.png');
}

export function getRendererEntryPath(): string {
  return path.join(__dirname, '../../dist/index.html');
}
