import { EventEmitter } from '../node/events';
import { UltimaCore } from '../native/UltimaCore';

/**
 * The slice of Electron's main-process API that the desktop IPC layer uses.
 * `ipcMain.handle` registrations are invoked in-process by the bridge that
 * stands in for the preload script (`backend/bridge.ts`).
 */

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

export interface IpcMainInvokeEvent {
  sender: WebContents;
}

export type IpcMainEvent = IpcMainInvokeEvent;

export interface WebContents {
  id: number;
  send(channel: string, ...args: unknown[]): void;
}

const handlers = new Map<string, InvokeHandler>();

export const ipcMain = Object.assign(new EventEmitter(), {
  handle(channel: string, handler: InvokeHandler): void {
    if (handlers.has(channel)) {
      throw new Error(
        `Attempted to register a second handler for '${channel}'`,
      );
    }
    handlers.set(channel, handler);
  },
  removeHandler(channel: string): void {
    handlers.delete(channel);
  },
});

/** Calls a registered handler the way `ipcRenderer.invoke` would. */
export async function invokeIpcHandler(
  sender: WebContents,
  channel: string,
  args: unknown[],
): Promise<unknown> {
  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`No handler registered for '${channel}'`);
  }
  return handler({ sender }, ...args);
}

interface AppPaths {
  userData: string;
  logs: string;
  temp: string;
}

let appPaths: AppPaths = { userData: '/', logs: '/logs', temp: '/tmp' };
let appVersion = '0.0.0';

export function configureElectronShim(options: {
  dataDir: string;
  version: string;
}): void {
  appPaths = {
    userData: options.dataDir,
    logs: `${options.dataDir}/logs`,
    temp: `${options.dataDir}/tmp`,
  };
  appVersion = options.version;
}

export const app = Object.assign(new EventEmitter(), {
  isPackaged: true,
  getPath(name: string): string {
    if (name in appPaths) return appPaths[name as keyof AppPaths];
    return appPaths.userData;
  },
  getVersion(): string {
    return appVersion;
  },
  getName(): string {
    return 'UltimaVLESS';
  },
  getLocale(): string {
    return navigator.language;
  },
  whenReady(): Promise<void> {
    return Promise.resolve();
  },
  quit(): void {},
  exit(): void {},
});

export const shell = {
  async openExternal(url: string): Promise<void> {
    await UltimaCore.openUrl({ url });
  },
  async openPath(): Promise<string> {
    return 'Opening folders is not available on Android';
  },
};

export class BrowserWindow {
  static fromWebContents(): BrowserWindow | null {
    return null;
  }

  static getAllWindows(): BrowserWindow[] {
    return [];
  }
}

export type OpenDialogOptions = Record<string, unknown>;

export const dialog = {
  async showOpenDialog(): Promise<{ canceled: boolean; filePaths: string[] }> {
    return { canceled: true, filePaths: [] };
  },
};

export const powerMonitor = new EventEmitter();

export default {
  app,
  ipcMain,
  shell,
  BrowserWindow,
  dialog,
  powerMonitor,
};
