import { EventEmitter } from 'events';
import type { VlessConfig } from '@/shared/types';
import type { PingResult, SessionPhase } from '@/shared/ipc';
import {
  allServersHaveFreshPing,
  DEFAULT_MIN_PING_INTERVAL_MS,
  filterServersNeedingPing,
} from '@/shared/pingFilters';
import { PerfTimer } from '@/shared/perfMetrics';
import { logger } from '@/main/services/LoggerService';
import { createSerialQueue } from '@/main/ipc/serialQueue';
import {
  createPingAllCoordinator,
  type PingPersistStore,
} from '@/main/ipc/pingAllCoordinator';

export type PingAutoTrigger = 'startup' | 'catalog-changed' | 'session-idle';
export type PingRefreshTrigger = 'user' | PingAutoTrigger;

export interface PingRefreshChange {
  immediate: boolean;
}

export interface PingProbe {
  pingServers(
    servers: VlessConfig[],
    timeout: number,
    options: {
      onResult?: (uuid: string, latency: number | null) => void;
      signal?: AbortSignal;
    },
  ): Promise<Map<string, number | null>>;
}

export interface PingRefreshRunnerDeps {
  store: PingPersistStore;
  pingService: PingProbe;
  /** Connected / in-flight sessions: probing would go through the tunnel. */
  isUnsafe: () => boolean;
  now?: () => number;
  initialTimeoutMs?: number;
  retryTimeoutMs?: number;
  retryDelayMs?: number;
  minPingIntervalMs?: number;
  autoDelays?: Partial<Record<PingAutoTrigger, number>>;
}

export interface PingRefreshRunner {
  /** Measures the catalog; runs are serialized, `force` re-probes fresh rows too. */
  run(options: {
    force: boolean;
    trigger: PingRefreshTrigger;
  }): Promise<PingResult[]>;
  /** True while a foreground pass is probing (background retries excluded). */
  isRunning(): boolean;
  /** Debounced, non-forced pass driven by app state rather than the user. */
  requestAuto(trigger: PingAutoTrigger, delayMs?: number): void;
  /** Feeds session transitions so a disconnect refreshes stale figures. */
  handleSessionPhase(phase: SessionPhase): void;
  on(event: 'changed', listener: (change: PingRefreshChange) => void): this;
  off(event: 'changed', listener: (change: PingRefreshChange) => void): this;
  removeAllListeners(event?: 'changed'): this;
  dispose(): void;
}

export const PING_INITIAL_TIMEOUT_MS = 1800;
export const PING_RETRY_TIMEOUT_MS = 3500;
export const PING_RETRY_DELAY_MS = 250;

export const PING_AUTO_DELAYS_MS: Record<PingAutoTrigger, number> = {
  startup: 0,
  'catalog-changed': 1000,
  'session-idle': 1500,
};

/** Phases in which the network stack is not engaged by a session. */
const SETTLED_PHASES = new Set<SessionPhase>(['idle', 'failed']);

export function isPingUnsafePhase(phase: SessionPhase, busy: boolean): boolean {
  return (
    busy ||
    phase === 'connected' ||
    phase === 'connecting' ||
    phase === 'switching'
  );
}

interface PingAutoSchedulerDeps {
  run: (trigger: PingAutoTrigger) => Promise<unknown>;
  isUnsafe: () => boolean;
  now?: () => number;
  delays?: Partial<Record<PingAutoTrigger, number>>;
}

export interface PingAutoScheduler {
  schedule(trigger: PingAutoTrigger, delayMs?: number): void;
  handleSessionPhase(phase: SessionPhase): void;
  dispose(): void;
}

/**
 * Policy for unattended pings. Keeps a single pending timer (the earliest
 * request wins), never probes while a session holds the stack, and treats a
 * return to idle/failed as a reason to re-measure what the session hid.
 */
export function createPingAutoScheduler(
  deps: PingAutoSchedulerDeps,
): PingAutoScheduler {
  const now = deps.now ?? Date.now;
  const delays = { ...PING_AUTO_DELAYS_MS, ...deps.delays };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dueAt = Number.POSITIVE_INFINITY;
  let pendingTrigger: PingAutoTrigger | null = null;
  let lastPhase: SessionPhase = 'idle';

  const fire = (): void => {
    timer = null;
    dueAt = Number.POSITIVE_INFINITY;
    const trigger = pendingTrigger ?? 'startup';
    pendingTrigger = null;
    if (deps.isUnsafe()) {
      logger.debug('PingRefresh', 'Auto ping skipped: session is active', {
        trigger,
      });
      return;
    }
    deps.run(trigger).catch((error) => {
      logger.error('PingRefresh', 'Auto ping failed', error);
    });
  };

  const schedule = (
    trigger: PingAutoTrigger,
    delayMs: number = delays[trigger],
  ): void => {
    const at = now() + delayMs;
    if (timer !== null) {
      if (dueAt <= at) {
        return;
      }
      clearTimeout(timer);
    }
    pendingTrigger = trigger;
    dueAt = at;
    timer = setTimeout(fire, delayMs);
  };

  return {
    schedule,
    handleSessionPhase(phase) {
      const wasEngaged = !SETTLED_PHASES.has(lastPhase);
      lastPhase = phase;
      if (wasEngaged && SETTLED_PHASES.has(phase)) {
        schedule('session-idle');
      }
    },
    dispose() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pendingTrigger = null;
      dueAt = Number.POSITIVE_INFINITY;
    },
  };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Owner of ping-all execution for both the toolbar button and unattended
 * refreshes. Foreground passes are serialized; failed rows get one background
 * retry with a longer timeout that never blocks the next pass and only fills
 * rows that are still empty.
 */
export function createPingRefreshRunner(
  deps: PingRefreshRunnerDeps,
): PingRefreshRunner {
  const emitter = new EventEmitter();
  const now = deps.now ?? Date.now;
  const initialTimeoutMs = deps.initialTimeoutMs ?? PING_INITIAL_TIMEOUT_MS;
  const retryTimeoutMs = deps.retryTimeoutMs ?? PING_RETRY_TIMEOUT_MS;
  const retryDelayMs = deps.retryDelayMs ?? PING_RETRY_DELAY_MS;
  const minPingIntervalMs =
    deps.minPingIntervalMs ?? DEFAULT_MIN_PING_INTERVAL_MS;

  const runQueue = createSerialQueue();
  const retryQueue = createSerialQueue();
  let retryAbort = new AbortController();
  let activeRuns = 0;
  let queuedAutoRun: Promise<PingResult[]> | null = null;

  const emitChanged = (immediate: boolean): void => {
    emitter.emit('changed', { immediate } satisfies PingRefreshChange);
  };

  const coordinator = createPingAllCoordinator({
    store: deps.store,
    notifySnapshot: (_reason, options) =>
      emitChanged(options?.immediate ?? false),
    isUnsafe: deps.isUnsafe,
    now,
  });

  const toResults = (servers: VlessConfig[]): PingResult[] =>
    servers.map((server) => ({
      uuid: server.uuid,
      latency: server.ping ?? null,
    }));

  const runRetry = async (
    failed: VlessConfig[],
    signal: AbortSignal,
  ): Promise<void> => {
    if (signal.aborted) return;
    await sleep(retryDelayMs);
    if (signal.aborted || deps.isUnsafe()) return;

    logger.debug('PingRefresh', 'Retrying failed servers in background', {
      failed: failed.length,
      retryTimeoutMs,
    });
    const fill = coordinator.beginFill();
    const results = await deps.pingService.pingServers(failed, retryTimeoutMs, {
      signal,
      onResult: (uuid, latency) => {
        if (latency != null) {
          fill.onResult(uuid, latency);
        }
      },
    });
    if (signal.aborted) return;

    const recovered = new Map<string, number | null>();
    for (const [uuid, latency] of results) {
      if (latency != null) {
        recovered.set(uuid, latency);
      }
    }
    if (recovered.size === 0) return;
    if (deps.isUnsafe()) {
      logger.debug(
        'PingRefresh',
        'Dropping retry ping results (session became active)',
      );
      return;
    }
    fill.persist(recovered, { immediate: true });
  };

  const supersedeRetries = (): void => {
    retryAbort.abort();
    retryAbort = new AbortController();
  };

  const scheduleRetry = (failed: VlessConfig[]): void => {
    const signal = retryAbort.signal;
    void retryQueue
      .enqueue(() => runRetry(failed, signal))
      .catch((error) => {
        logger.error('PingRefresh', 'Background retry ping failed', error);
      });
  };

  const executeRun = async (
    force: boolean,
    trigger: PingRefreshTrigger,
  ): Promise<PingResult[]> => {
    const timer = new PerfTimer('PingRefresh', 'run');
    const servers = deps.store.list();
    if (deps.isUnsafe()) {
      logger.debug('PingRefresh', 'Skipping ping-all while session is active', {
        trigger,
      });
      timer.end({ trigger, skipped: 'unsafe' });
      return toResults(servers);
    }
    if (
      !force &&
      servers.length > 0 &&
      allServersHaveFreshPing(servers, minPingIntervalMs, now())
    ) {
      timer.end({ trigger, skipped: 'fresh', total: servers.length });
      return toResults(servers);
    }
    const targets = filterServersNeedingPing(servers, {
      force,
      minPingIntervalMs,
      now: now(),
    });
    if (targets.length === 0) {
      timer.end({ trigger, skipped: 'no-targets' });
      return toResults(servers);
    }

    if (force) {
      // The user asked for a complete fresh pass: whatever an older retry is
      // still probing is re-measured here, so stop it instead of doubling
      // the sockets to the slowest hosts.
      supersedeRetries();
    }
    const run = coordinator.beginRun();
    activeRuns += 1;
    emitChanged(true);
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      activeRuns -= 1;
    };

    try {
      const results = await deps.pingService.pingServers(
        targets,
        initialTimeoutMs,
        { onResult: run.onResult },
      );
      // Flip the in-progress flag before the final persist so one snapshot
      // carries both the figures and the idle button state.
      finish();
      if (deps.isUnsafe() || !run.isCurrent()) {
        logger.debug(
          'PingRefresh',
          'Dropping ping-all results (network state changed)',
          { trigger },
        );
        emitChanged(true);
        timer.end({ trigger, dropped: true });
        return toResults(deps.store.list());
      }

      const updated = run.persist(results, { immediate: true });
      const failed = targets.filter(
        (server) => results.get(server.uuid) == null,
      );
      const durationMs = timer.end({
        trigger,
        force,
        total: servers.length,
        probed: targets.length,
        failed: failed.length,
      });
      logger.info('PingRefresh', 'Ping pass finished', {
        trigger,
        force,
        total: servers.length,
        probed: targets.length,
        failed: failed.length,
        durationMs,
      });
      if (failed.length > 0) {
        scheduleRetry(failed);
      }
      return toResults(updated);
    } finally {
      if (!finished) {
        finish();
        emitChanged(true);
      }
    }
  };

  const scheduler = createPingAutoScheduler({
    run: (trigger) => runner.run({ force: false, trigger }),
    isUnsafe: deps.isUnsafe,
    now,
    delays: deps.autoDelays,
  });

  const runner = Object.assign(emitter, {
    run({ force, trigger }: { force: boolean; trigger: PingRefreshTrigger }) {
      if (force) {
        return runQueue.enqueue(() => executeRun(true, trigger));
      }
      // Unattended passes coalesce: a second request while one is still
      // waiting for the queue joins it instead of probing twice.
      if (queuedAutoRun) {
        return queuedAutoRun;
      }
      const job = runQueue.enqueue(() => {
        queuedAutoRun = null;
        return executeRun(false, trigger);
      });
      queuedAutoRun = job;
      return job;
    },
    isRunning() {
      return activeRuns > 0;
    },
    requestAuto(trigger: PingAutoTrigger, delayMs?: number) {
      scheduler.schedule(trigger, delayMs);
    },
    handleSessionPhase(phase: SessionPhase) {
      scheduler.handleSessionPhase(phase);
    },
    dispose() {
      scheduler.dispose();
      supersedeRetries();
      emitter.removeAllListeners();
    },
  }) as PingRefreshRunner;

  return runner;
}
