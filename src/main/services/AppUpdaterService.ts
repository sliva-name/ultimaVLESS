import { app } from 'electron';
import { EventEmitter } from 'events';
import type { UpdateStatus } from '@/shared/ipc';
import { logger } from './LoggerService';
import { mainLocaleService } from './MainLocaleService';
import { trayService } from './TrayService';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

type AutoUpdaterLike = {
  autoDownload?: boolean;
  autoInstallOnAppQuit?: boolean;
  allowPrerelease?: boolean;
  logger?: unknown;
  on(event: 'checking-for-update', listener: () => void): AutoUpdaterLike;
  on(event: 'update-available', listener: (info: { version?: string; releaseNotes?: string | null }) => void): AutoUpdaterLike;
  on(event: 'update-not-available', listener: () => void): AutoUpdaterLike;
  on(event: 'error', listener: (error: Error) => void): AutoUpdaterLike;
  on(event: 'download-progress', listener: (progress: { percent?: number; bytesPerSecond?: number }) => void): AutoUpdaterLike;
  on(event: 'update-downloaded', listener: (info: { version?: string; releaseNotes?: string | null }) => void): AutoUpdaterLike;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
};

const DISABLED_STATUS: UpdateStatus = {
  stage: 'disabled',
  version: null,
  releaseNotes: null,
  percent: 0,
  bytesPerSecond: 0,
  error: null,
  updatedAt: Date.now(),
};

/**
 * Thin wrapper around `electron-updater` that keeps a single source of truth
 * for the update lifecycle, exposes structured events to IPC, and triggers
 * desktop notifications on important transitions. Disabled in dev / portable
 * / non-packaged builds where auto-updates are not meaningful.
 */
export class AppUpdaterService extends EventEmitter {
  private status: UpdateStatus = { ...DISABLED_STATUS };
  private updater: AutoUpdaterLike | null = null;
  private checkTimer: NodeJS.Timeout | null = null;
  private started = false;

  public async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    if (!app.isPackaged) {
      logger.info('AppUpdaterService', 'Auto-updates disabled: app is not packaged');
      this.setStatus({ stage: 'disabled' });
      return;
    }
    if (process.env.ELECTRON_UPDATER_DISABLE === '1') {
      logger.info('AppUpdaterService', 'Auto-updates disabled via ELECTRON_UPDATER_DISABLE=1');
      this.setStatus({ stage: 'disabled' });
      return;
    }
    if (process.env.PORTABLE_EXECUTABLE_DIR) {
      // Windows portable builds cannot self-update in-place.
      logger.info('AppUpdaterService', 'Auto-updates disabled: portable build detected');
      this.setStatus({ stage: 'disabled' });
      return;
    }

    try {
      const mod = await import('electron-updater');
      const updater = (mod.autoUpdater ?? mod.default?.autoUpdater) as AutoUpdaterLike | undefined;
      if (!updater) {
        logger.warn('AppUpdaterService', 'electron-updater did not expose autoUpdater');
        this.setStatus({ stage: 'disabled' });
        return;
      }
      this.updater = updater;
      this.attach(updater);
      this.scheduleChecks();
      // Fire a first check shortly after start so the UI picks up any pending
      // update without waiting a full polling interval.
      setTimeout(() => {
        void this.checkForUpdates();
      }, 8000);
    } catch (error) {
      logger.warn('AppUpdaterService', 'Failed to load electron-updater', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.setStatus({ stage: 'disabled' });
    }
  }

  public getStatus(): UpdateStatus {
    return this.status;
  }

  public async checkForUpdates(): Promise<void> {
    if (!this.updater) return;
    try {
      this.setStatus({ stage: 'checking', error: null });
      await this.updater.checkForUpdates();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('AppUpdaterService', 'checkForUpdates threw', { error: message });
      this.setStatus({ stage: 'error', error: message });
    }
  }

  public quitAndInstall(): void {
    if (!this.updater) return;
    try {
      this.updater.quitAndInstall(false, true);
    } catch (error) {
      logger.error('AppUpdaterService', 'quitAndInstall failed', error);
    }
  }

  private attach(updater: AutoUpdaterLike): void {
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.allowPrerelease = false;
    try {
      (updater.logger as unknown) = null;
    } catch {
      /* optional hook, safe to ignore */
    }

    updater.on('checking-for-update', () => {
      this.setStatus({ stage: 'checking', error: null });
    });
    updater.on('update-available', (info) => {
      const version = info?.version ?? null;
      this.setStatus({
        stage: 'available',
        version,
        releaseNotes: normalizeNotes(info?.releaseNotes),
        error: null,
        percent: 0,
        bytesPerSecond: 0,
      });
      if (version) {
        trayService.notify(
          mainLocaleService.t('notify.updateAvailable.title'),
          mainLocaleService.t('notify.updateAvailable.body', { version })
        );
      }
    });
    updater.on('update-not-available', () => {
      this.setStatus({ stage: 'not-available', error: null });
    });
    updater.on('download-progress', (progress) => {
      this.setStatus({
        stage: 'downloading',
        percent: Math.round(progress?.percent ?? 0),
        bytesPerSecond: Math.round(progress?.bytesPerSecond ?? 0),
      });
    });
    updater.on('update-downloaded', (info) => {
      const version = info?.version ?? this.status.version;
      this.setStatus({
        stage: 'downloaded',
        version,
        releaseNotes: normalizeNotes(info?.releaseNotes) ?? this.status.releaseNotes,
        percent: 100,
      });
      if (version) {
        trayService.notify(
          mainLocaleService.t('notify.updateReady.title'),
          mainLocaleService.t('notify.updateReady.body', { version })
        );
      }
    });
    updater.on('error', (error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('AppUpdaterService', 'Updater error', { error: message });
      this.setStatus({ stage: 'error', error: message });
    });
  }

  private scheduleChecks(): void {
    if (this.checkTimer) clearInterval(this.checkTimer);
    this.checkTimer = setInterval(() => {
      void this.checkForUpdates();
    }, CHECK_INTERVAL_MS);
  }

  private setStatus(patch: Partial<UpdateStatus>): void {
    this.status = {
      ...this.status,
      ...patch,
      updatedAt: Date.now(),
    };
    this.emit('status', this.status);
  }
}

function normalizeNotes(notes: string | null | undefined): string | null {
  if (typeof notes !== 'string') return null;
  const trimmed = notes.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export const appUpdaterService = new AppUpdaterService();
