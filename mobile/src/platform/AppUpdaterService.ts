import { EventEmitter } from '../node/events';
import type { UpdateStatus } from '@/shared/ipc';
import { app } from '../electron';
import { logger } from './LoggerService';
import { UltimaCore } from '../native/UltimaCore';

const REPO_URL = 'https://github.com/sliva-name/ultimaVLESS';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 8000;
const BUSY_RETRY_MS = 5000;
const REQUEST_TIMEOUT_MS = 15_000;
const HEADERS = { 'User-Agent': 'UltimaVLESS-Android' };

function parseVersion(value: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  return match ? match.slice(1).map(Number) : null;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate);
  const now = parseVersion(current);
  if (!next || !now) return false;
  for (let i = 0; i < 3; i++) {
    if (next[i] !== now[i]) return next[i] > now[i];
  }
  return false;
}

/** The APK for this device's ABI first, then the universal one. */
export function apkAssetNames(version: string, abi: string): string[] {
  return [
    `UltimaVLESS-Android-${version}-${abi}.apk`,
    `UltimaVLESS-Android-${version}-universal.apk`,
  ];
}

/** `vX.Y.Z` from the redirect of `/releases/latest` to `/releases/tag/vX.Y.Z`. */
export function tagFromLatestRedirect(location: string): string | null {
  const match = /\/releases\/tag\/([^/?#]+)/.exec(location);
  return match ? decodeURIComponent(match[1]) : null;
}

async function latestReleaseTag(): Promise<string | null> {
  const response = await UltimaCore.httpRequest({
    url: `${REPO_URL}/releases/latest`,
    method: 'HEAD',
    headers: HEADERS,
    timeoutMs: REQUEST_TIMEOUT_MS,
    followRedirects: false,
    maxBodyBytes: 0,
  });
  if (response.status < 300 || response.status >= 400) {
    throw new Error(`GitHub answered HTTP ${response.status}`);
  }
  return tagFromLatestRedirect(response.headers.location ?? '');
}

/** Release downloads redirect to storage when the asset exists. */
async function releaseAssetExists(url: string): Promise<boolean> {
  const response = await UltimaCore.httpRequest({
    url,
    method: 'HEAD',
    headers: HEADERS,
    timeoutMs: REQUEST_TIMEOUT_MS,
    followRedirects: false,
    maxBodyBytes: 0,
  });
  if (response.status === 404) return false;
  if (response.status >= 200 && response.status < 400) return true;
  throw new Error(`GitHub answered HTTP ${response.status}`);
}

/**
 * GitHub-release updates for sideloaded APKs, with the desktop updater's
 * stages: a newer release is downloaded in the background, then "install"
 * hands the APK to the system package installer.
 *
 * Only github.com itself is asked, never api.github.com: its anonymous rate
 * limit is shared by everyone behind the same VPN or carrier NAT address. A
 * check that fails is logged and retried at the next interval without a
 * banner, as desktop treats network failures; a failed download is shown.
 */
export class AppUpdaterService extends EventEmitter {
  private status: UpdateStatus = {
    stage: 'idle',
    version: null,
    releaseNotes: null,
    percent: 0,
    bytesPerSecond: 0,
    error: null,
    updatedAt: Date.now(),
  };
  private started = false;
  private checking = false;
  private downloadedPath: string | null = null;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private deferTimer: ReturnType<typeof setTimeout> | null = null;
  private isConnectionBusy: () => boolean = () => false;

  public setConnectionBusyGetter(getter: () => boolean): void {
    this.isConnectionBusy = getter;
  }

  public setPrepareForQuit(): void {}

  public async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (import.meta.env.DEV) {
      this.setStatus({ stage: 'disabled' });
      return;
    }
    await UltimaCore.addListener('updateProgress', (progress) => {
      if (this.status.stage !== 'downloading') return;
      this.setStatus({
        percent: Math.round(progress.percent),
        bytesPerSecond: progress.bytesPerSecond,
      });
    });
    this.checkTimer = setInterval(() => {
      void this.checkForUpdates();
    }, CHECK_INTERVAL_MS);
    this.deferTimer = setTimeout(() => {
      void this.checkForUpdates();
    }, INITIAL_CHECK_DELAY_MS);
  }

  public getStatus(): UpdateStatus {
    return this.status;
  }

  public async checkForUpdates(): Promise<void> {
    if (this.status.stage === 'disabled' || this.checking) return;
    if (this.status.stage === 'downloading' || this.downloadedPath) return;
    if (this.isConnectionBusy()) {
      if (this.deferTimer) clearTimeout(this.deferTimer);
      this.deferTimer = setTimeout(() => {
        void this.checkForUpdates();
      }, BUSY_RETRY_MS);
      return;
    }
    this.checking = true;
    this.setStatus({ stage: 'checking', error: null });
    try {
      const update = await this.findUpdate();
      if (!update) {
        this.setStatus({ stage: 'not-available', version: null });
        return;
      }
      logger.info('AppUpdaterService', 'Update available', update);
      this.setStatus({
        stage: 'downloading',
        version: update.version,
        releaseNotes: null,
        percent: 0,
        bytesPerSecond: 0,
      });
      try {
        const { path } = await UltimaCore.downloadUpdate({
          url: update.url,
          fileName: update.fileName,
        });
        this.downloadedPath = path;
        this.setStatus({ stage: 'downloaded', percent: 100 });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('AppUpdaterService', 'Update download failed', {
          error: message,
        });
        this.setStatus({ stage: 'error', error: message.slice(0, 300) });
      }
    } catch (error) {
      logger.warn('AppUpdaterService', 'Update check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.setStatus({ stage: 'idle', error: null });
    } finally {
      this.checking = false;
    }
  }

  private async findUpdate(): Promise<{
    version: string;
    url: string;
    fileName: string;
  } | null> {
    const tag = await latestReleaseTag();
    if (!tag || !isNewerVersion(tag, app.getVersion())) return null;
    const version = tag.replace(/^v/i, '');
    const { abi } = await UltimaCore.getAppInfo();
    for (const fileName of apkAssetNames(version, abi)) {
      const url = `${REPO_URL}/releases/download/${encodeURIComponent(tag)}/${fileName}`;
      if (await releaseAssetExists(url)) return { version, url, fileName };
    }
    // The tag is out while its APKs are still being built, or the release
    // has no Android build: check again at the next interval.
    return null;
  }

  public hasDownloadedUpdate(): boolean {
    return this.downloadedPath !== null && this.status.stage === 'downloaded';
  }

  public installDownloadedUpdate(): boolean {
    return false;
  }

  public async quitAndInstall(): Promise<void> {
    if (!this.downloadedPath) return;
    await UltimaCore.installUpdate({ path: this.downloadedPath });
  }

  public dispose(): void {
    if (this.checkTimer) clearInterval(this.checkTimer);
    if (this.deferTimer) clearTimeout(this.deferTimer);
    this.checkTimer = null;
    this.deferTimer = null;
  }

  private setStatus(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch, updatedAt: Date.now() };
    this.emit('status', this.status);
  }
}

export const appUpdaterService = new AppUpdaterService();
