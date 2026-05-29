import type { BrowserWindow } from 'electron';
import { IPC_EVENT_CHANNELS } from '@/shared/ipc';
import { buildAppSnapshot } from '@/main/ipc/appSnapshot';
import type { IpcDependencies } from '@/main/ipc/dependencies';

export type SnapshotReason =
  | 'bootstrap'
  | 'connection'
  | 'monitor'
  | 'traffic'
  | 'settings'
  | 'subscriptions'
  | 'ping'
  | 'recovery'
  | 'manual';

interface SnapshotPublisherOptions {
  deps: IpcDependencies;
  getWindow: () => BrowserWindow | null;
}

/**
 * Single projection boundary from main-process runtime state to renderer UI.
 * Callers do not build or send snapshots themselves; they only announce that
 * a domain state changed.
 */
export class SnapshotPublisher {
  constructor(private readonly options: SnapshotPublisherOptions) {}

  public push(_reason: SnapshotReason = 'manual'): void {
    const win = this.options.getWindow();
    if (!win) return;
    win.webContents.send(
      IPC_EVENT_CHANNELS.appSnapshotChanged,
      buildAppSnapshot(this.options.deps),
    );
  }
}
