import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { logger } from './LoggerService';
import { WindowsProxyAdapter } from './systemProxy/windowsProxy';
import { DarwinProxyAdapter } from './systemProxy/darwinProxy';
import { LinuxProxyAdapter } from './systemProxy/linuxProxy';
import { ProxySnapshot } from './systemProxy/types';

/**
 * Coordinates system-proxy changes across Windows / macOS / Linux by delegating
 * to platform-specific adapters and persisting pre-change snapshots so that
 * `disable()` can restore the user's original state even across app restarts.
 */
export class SystemProxyService {
  private readonly platform: NodeJS.Platform;
  private readonly snapshotPath: string;
  private readonly windows: WindowsProxyAdapter | null;
  private readonly darwin: DarwinProxyAdapter | null;
  private readonly linux: LinuxProxyAdapter | null;
  private activeSnapshot: ProxySnapshot | null = null;
  /** Serializes enable()/disable() so concurrent callers cannot interleave and corrupt snapshot. */
  private operationChain: Promise<unknown> = Promise.resolve();

  constructor(platform: NodeJS.Platform = process.platform) {
    this.platform = platform;
    this.snapshotPath = path.join(
      app.getPath('userData'),
      'system-proxy-state.json',
    );
    this.windows =
      platform === 'win32'
        ? new WindowsProxyAdapter(app.getPath('userData'))
        : null;
    this.darwin = platform === 'darwin' ? new DarwinProxyAdapter() : null;
    this.linux = platform === 'linux' ? new LinuxProxyAdapter() : null;
  }

  public enable(httpPort: number, socksPort: number): Promise<void> {
    return this.runSerialized(async () => {
      if (this.darwin) {
        const snapshot = await this.darwin.captureState();
        await this.darwin.enable(httpPort, socksPort);
        this.commitSnapshot(snapshot);
        return;
      }
      if (this.linux) {
        const snapshot = await this.linux.captureState();
        await this.linux.enable(httpPort, socksPort);
        this.commitSnapshot(snapshot);
        return;
      }
      if (this.windows) {
        const snapshot = await this.windows.captureState();
        await this.windows.enable(httpPort, socksPort);
        this.commitSnapshot(snapshot);
        return;
      }
      logger.info(
        'SystemProxyService',
        'Unsupported platform for system proxy operations',
        {
          platform: this.platform,
        },
      );
    });
  }

  public disable(): Promise<void> {
    return this.runSerialized(async () => {
      if (this.darwin) {
        await this.restoreSnapshotOrFallback(() => this.darwin!.disable());
        return;
      }
      if (this.linux) {
        await this.restoreSnapshotOrFallback(() => this.linux!.disable());
        return;
      }
      if (this.windows) {
        await this.restoreSnapshotOrFallback(() => this.windows!.disableRaw());
        return;
      }
    });
  }

  private runSerialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationChain.then(
      () => operation(),
      () => operation(),
    );
    this.operationChain = next.catch(() => undefined);
    return next;
  }

  /** Only persist the pre-change state *after* enable succeeds, so a failed enable cannot corrupt the restore path. */
  private commitSnapshot(snapshot: ProxySnapshot): void {
    // If a previous snapshot is still active (e.g. enable called twice without
    // a disable between), preserve the earliest known-good pre-enable state.
    if (this.activeSnapshot) return;
    this.activeSnapshot = snapshot;
    this.saveSnapshot(snapshot);
  }

  private async restoreSnapshotOrFallback(
    fallback: () => Promise<void>,
  ): Promise<void> {
    const snapshot = this.activeSnapshot ?? this.loadSnapshot();
    if (!snapshot) {
      await fallback();
      return;
    }
    await this.restoreProxyState(snapshot);
    this.activeSnapshot = null;
    this.clearSnapshot();
  }

  private async restoreProxyState(snapshot: ProxySnapshot): Promise<void> {
    if (snapshot.platform === 'win32' && this.windows) {
      await this.windows.restoreState(snapshot);
      return;
    }
    if (snapshot.platform === 'darwin' && this.darwin) {
      await this.darwin.restoreState(snapshot);
      return;
    }
    if (snapshot.platform === 'linux' && this.linux) {
      await this.linux.restoreState(snapshot);
      return;
    }
    logger.warn(
      'SystemProxyService',
      'No adapter available to restore proxy snapshot',
      {
        snapshotPlatform: snapshot.platform,
        runtimePlatform: this.platform,
      },
    );
  }

  private loadSnapshot(): ProxySnapshot | null {
    try {
      if (!fs.existsSync(this.snapshotPath)) return null;
      return JSON.parse(
        fs.readFileSync(this.snapshotPath, 'utf8'),
      ) as ProxySnapshot;
    } catch (error) {
      logger.warn('SystemProxyService', 'Failed to load proxy snapshot', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private saveSnapshot(snapshot: ProxySnapshot): void {
    try {
      fs.writeFileSync(this.snapshotPath, JSON.stringify(snapshot, null, 2));
    } catch (error) {
      logger.warn('SystemProxyService', 'Failed to persist proxy snapshot', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private clearSnapshot(): void {
    try {
      if (fs.existsSync(this.snapshotPath)) {
        fs.unlinkSync(this.snapshotPath);
      }
    } catch (error) {
      logger.warn('SystemProxyService', 'Failed to clear proxy snapshot', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const systemProxyService = new SystemProxyService();
