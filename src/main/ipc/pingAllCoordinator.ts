import type { VlessConfig } from '@/shared/types';
import { catalogListFingerprint } from '@/shared/serverIdentity';
import type { ServerPingOverlay } from '@/main/domain/server/ServerRepository';
import type { SnapshotReason } from '@/main/runtime/SnapshotPublisher';

export const PING_PARTIAL_DEBOUNCE_MS = 300;
export const PING_PARTIAL_BATCH_SIZE = 32;

export interface PingPersistStore {
  list(): VlessConfig[];
  saveAll(servers: VlessConfig[]): void;
  savePings?(overlay: ServerPingOverlay): void;
}

export interface PingAllCoordinatorOptions {
  store: PingPersistStore;
  notifySnapshot: (
    reason?: SnapshotReason,
    options?: { immediate?: boolean },
  ) => void;
  isUnsafe: () => boolean;
  now?: () => number;
  debounceMs?: number;
  batchSize?: number;
}

export function mergePingResults(
  servers: VlessConfig[],
  results: Map<string, number | null>,
  pingTime: number,
): VlessConfig[] {
  return servers.map((server) => {
    if (!results.has(server.uuid)) {
      return server;
    }
    return {
      ...server,
      ping: results.get(server.uuid) ?? null,
      pingTime,
      pingStale: false,
    };
  });
}

export function extractPingOverlay(servers: VlessConfig[]): ServerPingOverlay {
  const overlay: ServerPingOverlay = {};
  for (const server of servers) {
    if (
      server.ping === undefined &&
      server.pingTime === undefined &&
      server.pingStale === undefined
    ) {
      continue;
    }
    overlay[server.uuid] = {
      ping: server.ping ?? null,
      pingTime: server.pingTime,
      pingStale: server.pingStale,
    };
  }
  return overlay;
}

export interface PingAllRun {
  readonly generation: number;
  readonly startedCatalog: string;
  onResult(uuid: string, latency: number | null): void;
  persist(
    results: Map<string, number | null>,
    options?: { immediate?: boolean },
  ): VlessConfig[];
  flushPartials(): void;
  isCurrent(): boolean;
}

export interface PingAllCoordinator {
  beginRun(servers: VlessConfig[]): PingAllRun;
  get generation(): number;
}

export function createPingAllCoordinator(
  options: PingAllCoordinatorOptions,
): PingAllCoordinator {
  let generation = 0;
  const debounceMs = options.debounceMs ?? PING_PARTIAL_DEBOUNCE_MS;
  const batchSize = options.batchSize ?? PING_PARTIAL_BATCH_SIZE;
  const now = options.now ?? Date.now;

  const persistResults = (
    runGeneration: number,
    startedCatalog: string,
    results: Map<string, number | null>,
    immediate: boolean,
  ): VlessConfig[] => {
    const latest = options.store.list();
    if (runGeneration !== generation) {
      return latest;
    }
    if (catalogListFingerprint(latest) !== startedCatalog) {
      return latest;
    }
    if (options.isUnsafe()) {
      return latest;
    }
    const merged = mergePingResults(latest, results, now());
    if (options.store.savePings) {
      options.store.savePings(extractPingOverlay(merged));
    } else {
      options.store.saveAll(merged);
    }
    options.notifySnapshot('ping', { immediate });
    return merged;
  };

  return {
    get generation() {
      return generation;
    },
    beginRun(servers: VlessConfig[]): PingAllRun {
      const runGeneration = ++generation;
      const startedCatalog = catalogListFingerprint(servers);
      const incrementalResults = new Map<string, number | null>();
      let resultsSinceSchedule = 0;
      let persistTimer: ReturnType<typeof setTimeout> | null = null;

      const clearTimer = (): void => {
        if (persistTimer !== null) {
          clearTimeout(persistTimer);
          persistTimer = null;
        }
      };

      const persistIncremental = (immediate: boolean): VlessConfig[] => {
        clearTimer();
        resultsSinceSchedule = 0;
        if (incrementalResults.size === 0) {
          return options.store.list();
        }
        return persistResults(
          runGeneration,
          startedCatalog,
          incrementalResults,
          immediate,
        );
      };

      const schedulePartial = (): void => {
        if (persistTimer !== null) {
          return;
        }
        persistTimer = setTimeout(() => {
          persistTimer = null;
          persistIncremental(false);
        }, debounceMs);
      };

      return {
        generation: runGeneration,
        startedCatalog,
        isCurrent: () => runGeneration === generation,
        onResult(uuid: string, latency: number | null) {
          if (runGeneration !== generation) {
            return;
          }
          incrementalResults.set(uuid, latency);
          resultsSinceSchedule += 1;
          if (resultsSinceSchedule >= batchSize) {
            persistIncremental(false);
            return;
          }
          schedulePartial();
        },
        persist(results, persistOptions) {
          clearTimer();
          resultsSinceSchedule = 0;
          for (const [uuid, latency] of results) {
            incrementalResults.set(uuid, latency);
          }
          return persistResults(
            runGeneration,
            startedCatalog,
            incrementalResults,
            persistOptions?.immediate ?? true,
          );
        },
        flushPartials() {
          persistIncremental(false);
        },
      };
    },
  };
}
