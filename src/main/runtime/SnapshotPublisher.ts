import type { BrowserWindow } from 'electron';
import type { Subscription } from '@/shared/types';
import { IPC_EVENT_CHANNELS } from '@/shared/ipc';
import type { AppSnapshotRuntimePatch } from '@/shared/views/appSnapshot';
import { buildAppSnapshot } from '@/main/ipc/appSnapshot';
import type { IpcDependencies } from '@/main/ipc/dependencies';
import { toSafeServerList } from '@/shared/serverView';
import { isServerPublicOutboundCompatible } from '@/main/services/configGenerator/outboundCompat';
import { catalogListFingerprint } from '@/shared/serverIdentity';

export type SnapshotReason =
  | 'bootstrap'
  | 'connection'
  | 'monitor'
  | 'traffic'
  | 'settings'
  | 'subscriptions'
  | 'ping'
  | 'recovery'
  | 'health'
  | 'process'
  | 'manual';

export const SNAPSHOT_COALESCE_MS = 75;

const RUNTIME_ONLY_REASONS = new Set<SnapshotReason>(['traffic', 'process']);

export interface SnapshotPushOptions {
  immediate?: boolean;
}

interface SnapshotPublisherOptions {
  deps: IpcDependencies;
  getWindow: () => BrowserWindow | null;
  coalesceMs?: number;
  schedule?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (handle: ReturnType<typeof setTimeout>) => void;
}

interface CachedSlice<T> {
  key: string;
  value: T;
}

/**
 * Single projection boundary from main-process runtime state to renderer UI.
 * Callers do not build or send snapshots themselves; they only announce that
 * a domain state changed.
 */
export class SnapshotPublisher {
  private readonly pendingReasons = new Set<SnapshotReason>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cachedServers: CachedSlice<
    ReturnType<typeof toSafeServerList>
  > | null = null;
  private cachedSubscriptions: CachedSlice<Subscription[]> | null = null;
  private readonly coalesceMs: number;
  private readonly schedule: (
    callback: () => void,
    ms: number,
  ) => ReturnType<typeof setTimeout>;
  private readonly cancelSchedule: (
    handle: ReturnType<typeof setTimeout>,
  ) => void;

  constructor(private readonly options: SnapshotPublisherOptions) {
    this.coalesceMs = options.coalesceMs ?? SNAPSHOT_COALESCE_MS;
    this.schedule = options.schedule ?? setTimeout;
    this.cancelSchedule = options.cancelSchedule ?? clearTimeout;
  }

  public push(
    reason: SnapshotReason = 'manual',
    pushOptions: SnapshotPushOptions = {},
  ): void {
    this.pendingReasons.add(reason);
    if (pushOptions.immediate) {
      this.flush();
      return;
    }
    if (this.timer !== null) {
      return;
    }
    this.timer = this.schedule(() => {
      this.timer = null;
      this.flush();
    }, this.coalesceMs);
  }

  public flush(): void {
    if (this.timer !== null) {
      this.cancelSchedule(this.timer);
      this.timer = null;
    }
    if (this.pendingReasons.size === 0) {
      return;
    }
    const reasons = new Set(this.pendingReasons);
    this.pendingReasons.clear();

    const win = this.options.getWindow();
    if (!win) return;

    if (this.isRuntimeOnly(reasons)) {
      win.webContents.send(
        IPC_EVENT_CHANNELS.appSnapshotPatch,
        this.buildRuntimePatch(),
      );
      return;
    }

    win.webContents.send(
      IPC_EVENT_CHANNELS.appSnapshotChanged,
      this.buildFullSnapshot(),
    );
  }

  private isRuntimeOnly(reasons: Set<SnapshotReason>): boolean {
    if (reasons.size === 0) return false;
    for (const reason of reasons) {
      if (!RUNTIME_ONLY_REASONS.has(reason)) {
        return false;
      }
    }
    return true;
  }

  private buildRuntimePatch(): AppSnapshotRuntimePatch {
    return {
      traffic: this.options.deps.trafficStatsService.getLastSnapshot(),
      process: this.options.deps.xrayService.getHealthStatus(),
    };
  }

  private buildFullSnapshot() {
    return buildAppSnapshot(this.options.deps, {
      servers: this.projectServers(),
      subscriptions: this.projectSubscriptions(),
    });
  }

  private projectServers() {
    const list = this.options.deps.serverRepository.list();
    const key = `${catalogListFingerprint(list)}##${list
      .map(
        (server) =>
          `${server.uuid}|${server.ping ?? ''}|${server.pingTime ?? ''}|${server.pingStale ? 1 : 0}`,
      )
      .join('||')}`;
    if (this.cachedServers?.key === key) {
      return this.cachedServers.value;
    }
    const servers = toSafeServerList(list, (server, safe) =>
      isServerPublicOutboundCompatible(server)
        ? safe
        : { ...safe, outboundCompatible: false },
    );
    this.cachedServers = { key, value: servers };
    return servers;
  }

  private projectSubscriptions() {
    const subscriptions = this.options.deps.subscriptionRepository.list();
    const key = subscriptions
      .map(
        (subscription) =>
          `${subscription.id}|${subscription.enabled ? 1 : 0}|${subscription.url}|${subscription.name}`,
      )
      .join('||');
    if (this.cachedSubscriptions?.key === key) {
      return this.cachedSubscriptions.value;
    }
    this.cachedSubscriptions = { key, value: subscriptions };
    return subscriptions;
  }
}
