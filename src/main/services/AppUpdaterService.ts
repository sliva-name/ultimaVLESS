import { app } from 'electron';
import { EventEmitter } from 'events';
import type { UpdateStatus } from '@/shared/ipc';
import { logger } from './LoggerService';
import { mainLocaleService } from './MainLocaleService';
import { trayService } from './TrayService';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
/** Initial delay after `start()` before the first check fires. */
const INITIAL_CHECK_DELAY_MS = 8000;
/** When the connection is busy (TUN setup, server switch), wait at least this
 *  long after it settles before kicking the deferred check. Long enough to let
 *  Windows replace the default route and the OS DNS cache settle. */
const POST_BUSY_GRACE_MS = 5000;
/** Cap on how long we will defer a single check while the connection stays
 *  busy. After this we attempt anyway and treat the result as "transient" if
 *  it fails — better than waiting forever on a stuck connection flow. */
const MAX_DEFER_MS = 60_000;
/** How many consecutive transient (network-shaped) failures before we surface
 *  an error banner to the user. The first 1-2 failures right after a network
 *  change should be invisible. */
const TRANSIENT_ERROR_THRESHOLD = 3;
/** Backoff after a transient failure: 30s -> 60s -> 120s -> 240s, capped at
 *  the regular interval so we don't dwarf it. */
const TRANSIENT_RETRY_BACKOFF_MS = [30_000, 60_000, 120_000, 240_000] as const;

const TRANSIENT_ERROR_PATTERNS = [
  /ERR_ADDRESS_UNREACHABLE/i,
  /ERR_INTERNET_DISCONNECTED/i,
  /ERR_NAME_NOT_RESOLVED/i,
  /ERR_NETWORK_CHANGED/i,
  /ERR_PROXY_CONNECTION_FAILED/i,
  /ERR_CONNECTION_RESET/i,
  /ERR_CONNECTION_REFUSED/i,
  /ERR_CONNECTION_TIMED_OUT/i,
  /\bENETUNREACH\b/,
  /\bENOTFOUND\b/,
  /\bETIMEDOUT\b/,
  /\bECONNRESET\b/,
  /\bECONNREFUSED\b/,
  /\bEHOSTUNREACH\b/,
  /\bEAI_AGAIN\b/,
  /getaddrinfo/i,
  /network is unreachable/i,
];

function isTransientNetworkError(message: string): boolean {
  return TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

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
  private retryTimer: NodeJS.Timeout | null = null;
  private deferTimer: NodeJS.Timeout | null = null;
  private started = false;
  /** Counts consecutive transient network failures; reset on any non-error
   *  outcome (available / not-available / downloaded). */
  private transientFailureCount = 0;
  /** Plugged in by `IpcHandler` once the connection-busy flag exists, so the
   *  updater knows when to defer checks during TUN setup / server switches. */
  private isConnectionBusy: () => boolean = () => false;

  public setConnectionBusyGetter(getter: () => boolean): void {
    this.isConnectionBusy = getter;
  }

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
      // update without waiting a full polling interval. Routed through
      // `scheduleDeferredCheck` so it inherits the same connection-busy
      // backoff as periodic checks.
      this.scheduleDeferredCheck(INITIAL_CHECK_DELAY_MS, 'initial');
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

  /**
   * Public entry point used by IPC `check-for-updates`. Honours the busy gate
   * and the transient-error suppression so a manual click during a connection
   * transition still does the right thing.
   */
  public async checkForUpdates(): Promise<void> {
    if (!this.updater) return;
    if (this.shouldDeferDueToBusyConnection()) {
      logger.info('AppUpdaterService', 'Deferring update check while connection is busy');
      this.scheduleDeferredCheck(POST_BUSY_GRACE_MS, 'busy-deferred');
      return;
    }
    await this.runCheckNow();
  }

  public quitAndInstall(): void {
    if (!this.updater) return;
    try {
      this.updater.quitAndInstall(false, true);
    } catch (error) {
      logger.error('AppUpdaterService', 'quitAndInstall failed', error);
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async runCheckNow(): Promise<void> {
    if (!this.updater) return;
    try {
      this.setStatus({ stage: 'checking', error: null });
      await this.updater.checkForUpdates();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.handleCheckFailure(message, 'checkForUpdates threw');
    }
  }

  private shouldDeferDueToBusyConnection(): boolean {
    try {
      return this.isConnectionBusy();
    } catch {
      return false;
    }
  }

  /**
   * Schedules a single deferred check. If the connection is still busy when
   * the timer fires, we re-defer up to {@link MAX_DEFER_MS}. Multiple
   * `scheduleDeferredCheck` calls coalesce — only one timer runs at a time.
   */
  private scheduleDeferredCheck(initialDelayMs: number, reason: string): void {
    if (this.deferTimer) return;

    const startedAt = Date.now();
    const tick = (delayMs: number): void => {
      this.deferTimer = setTimeout(() => {
        this.deferTimer = null;
        if (!this.updater) return;
        const waitedFor = Date.now() - startedAt;
        if (this.shouldDeferDueToBusyConnection() && waitedFor < MAX_DEFER_MS) {
          tick(POST_BUSY_GRACE_MS);
          return;
        }
        if (waitedFor >= MAX_DEFER_MS) {
          logger.warn('AppUpdaterService', 'Update check defer cap reached, attempting anyway', {
            reason,
            waitedMs: waitedFor,
          });
        }
        void this.runCheckNow();
      }, delayMs);
    };
    tick(initialDelayMs);
  }

  /**
   * Centralised failure handler shared between the explicit `checkForUpdates`
   * promise rejection and the asynchronous `error` event from
   * `electron-updater`. Transient network errors during the first
   * {@link TRANSIENT_ERROR_THRESHOLD} attempts are kept off the UI banner —
   * the user almost certainly triggered them by (dis)connecting the VPN.
   */
  private handleCheckFailure(message: string, source: string): void {
    const transient = isTransientNetworkError(message);
    if (transient) {
      this.transientFailureCount += 1;
      logger.warn('AppUpdaterService', 'Transient network error during update check', {
        source,
        error: message,
        consecutive: this.transientFailureCount,
        willSurface: this.transientFailureCount >= TRANSIENT_ERROR_THRESHOLD,
      });
      const backoffIndex = Math.min(this.transientFailureCount - 1, TRANSIENT_RETRY_BACKOFF_MS.length - 1);
      const backoffMs = TRANSIENT_RETRY_BACKOFF_MS[backoffIndex];
      this.scheduleTransientRetry(backoffMs);
      if (this.transientFailureCount < TRANSIENT_ERROR_THRESHOLD) {
        // Don't blow away a previously good status (`available`, `downloaded`)
        // and don't show an error banner yet — the network is just flapping.
        if (this.status.stage === 'checking') {
          this.setStatus({ stage: 'not-available', error: null });
        }
        return;
      }
    } else {
      this.transientFailureCount = 0;
      logger.warn('AppUpdaterService', 'Update check failed', { source, error: message });
    }
    this.setStatus({ stage: 'error', error: message });
  }

  private scheduleTransientRetry(delayMs: number): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.updater) return;
      if (this.shouldDeferDueToBusyConnection()) {
        this.scheduleDeferredCheck(POST_BUSY_GRACE_MS, 'transient-retry-busy');
        return;
      }
      void this.runCheckNow();
    }, delayMs);
  }

  private attach(updater: AutoUpdaterLike): void {
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.allowPrerelease = false;
    try {
      (updater.logger as unknown) = logger;
    } catch {
      /* optional hook, safe to ignore */
    }

    updater.on('checking-for-update', () => {
      this.setStatus({ stage: 'checking', error: null });
    });
    updater.on('update-available', (info) => {
      this.transientFailureCount = 0;
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
      this.transientFailureCount = 0;
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
      this.transientFailureCount = 0;
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
      this.handleCheckFailure(message, 'updater error event');
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
