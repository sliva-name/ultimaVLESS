import type { VlessConfig } from '@/shared/types';
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

/**
 * Applies measured latencies onto the *current* catalog by uuid. A uuid is a
 * stable hash of the endpoint and its transport parameters, so a result stays
 * valid even if the catalog was refreshed mid-run; rows that vanished are
 * simply skipped. With `onlyMissing` a row keeps a latency it already has —
 * used by background retries so a slow late answer never overwrites a fresher
 * measurement.
 */
export function mergePingResults(
  servers: VlessConfig[],
  results: Map<string, number | null>,
  pingTime: number,
  options: { onlyMissing?: boolean } = {},
): VlessConfig[] {
  return servers.map((server) => {
    if (!results.has(server.uuid)) {
      return server;
    }
    if (options.onlyMissing && server.ping != null) {
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

/** Incremental sink: batches results, debounces persist, flushes on demand. */
export interface PingResultSink {
  onResult(uuid: string, latency: number | null): void;
  persist(
    results: Map<string, number | null>,
    options?: { immediate?: boolean },
  ): VlessConfig[];
  flushPartials(): void;
}

export interface PingAllRun extends PingResultSink {
  readonly generation: number;
  isCurrent(): boolean;
}

export interface PingAllCoordinator {
  /** A first pass over the catalog; supersedes any earlier run. */
  beginRun(): PingAllRun;
  /** A background fill that only writes rows still lacking a latency. */
  beginFill(): PingResultSink;
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
    results: Map<string, number | null>,
    immediate: boolean,
    guard: { isCurrent: () => boolean; onlyMissing: boolean },
  ): VlessConfig[] => {
    const latest = options.store.list();
    if (!guard.isCurrent()) {
      return latest;
    }
    if (options.isUnsafe()) {
      return latest;
    }
    const merged = mergePingResults(latest, results, now(), {
      onlyMissing: guard.onlyMissing,
    });
    if (options.store.savePings) {
      options.store.savePings(extractPingOverlay(merged));
    } else {
      options.store.saveAll(merged);
    }
    options.notifySnapshot('ping', { immediate });
    return merged;
  };

  const createSink = (guard: {
    isCurrent: () => boolean;
    onlyMissing: boolean;
  }): PingResultSink => {
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
      return persistResults(incrementalResults, immediate, guard);
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
      onResult(uuid, latency) {
        if (!guard.isCurrent()) {
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
          incrementalResults,
          persistOptions?.immediate ?? true,
          guard,
        );
      },
      flushPartials() {
        persistIncremental(false);
      },
    };
  };

  return {
    get generation() {
      return generation;
    },
    beginRun(): PingAllRun {
      const runGeneration = ++generation;
      const isCurrent = () => runGeneration === generation;
      return {
        generation: runGeneration,
        isCurrent,
        ...createSink({ isCurrent, onlyMissing: false }),
      };
    },
    beginFill(): PingResultSink {
      return createSink({ isCurrent: () => true, onlyMissing: true });
    },
  };
}
