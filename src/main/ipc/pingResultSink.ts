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

export interface PingResultSinkOptions {
  store: PingPersistStore;
  notifySnapshot: (
    reason?: SnapshotReason,
    options?: { immediate?: boolean },
  ) => void;
  isUnsafe: () => boolean;
  /** Background retry: never overwrite a latency a row already has. */
  onlyMissing?: boolean;
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

/** One ping pass (or its background retry) writing into the catalog. */
export function createPingResultSink(
  options: PingResultSinkOptions,
): PingResultSink {
  const debounceMs = options.debounceMs ?? PING_PARTIAL_DEBOUNCE_MS;
  const batchSize = options.batchSize ?? PING_PARTIAL_BATCH_SIZE;
  const now = options.now ?? Date.now;
  const incrementalResults = new Map<string, number | null>();
  let resultsSinceSchedule = 0;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  const persistResults = (immediate: boolean): VlessConfig[] => {
    const latest = options.store.list();
    if (options.isUnsafe()) {
      return latest;
    }
    const merged = mergePingResults(latest, incrementalResults, now(), {
      onlyMissing: options.onlyMissing,
    });
    if (options.store.savePings) {
      options.store.savePings(extractPingOverlay(merged));
    } else {
      options.store.saveAll(merged);
    }
    options.notifySnapshot('ping', { immediate });
    return merged;
  };

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
    return persistResults(immediate);
  };

  return {
    onResult(uuid, latency) {
      incrementalResults.set(uuid, latency);
      resultsSinceSchedule += 1;
      if (resultsSinceSchedule >= batchSize) {
        persistIncremental(false);
        return;
      }
      if (persistTimer === null) {
        persistTimer = setTimeout(() => {
          persistTimer = null;
          persistIncremental(false);
        }, debounceMs);
      }
    },
    persist(results, persistOptions) {
      for (const [uuid, latency] of results) {
        incrementalResults.set(uuid, latency);
      }
      return persistIncremental(persistOptions?.immediate ?? true);
    },
    flushPartials() {
      persistIncremental(false);
    },
  };
}
