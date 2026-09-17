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
  type PingResultSink,
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
    /** Stored server UUIDs to probe; omitted means all, empty means none. */
    serverIds?: string[];
  }): Promise<PingResult[]>;
  /** Cancels current and queued work, retaining measured partial results. */
  stop(): void;
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

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });

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
  let passAbort = new AbortController();
  let activeRuns = 0;
  let queuedAutoRun: Promise<PingResult[]> | null = null;

  const emitChanged = (immediate: boolean): void => {
    emitter.emit('changed', { immediate } satisfies PingRefreshChange);
  };

  let activeFinish: (() => void) | null = null;
  const sinks = new Map<AbortSignal, (preserve: boolean) => void>();

  // Each sink owns its cancellation guard, including its debounced writes.
  const beginSink = (signal: AbortSignal, retry = false) => {
    let closed = false;
    let flushing = false;
    const coordinator = createPingAllCoordinator({
      store: deps.store,
      notifySnapshot: (_reason, options) =>
        emitChanged(options?.immediate ?? false),
      isUnsafe: () =>
        closed || (signal.aborted && !flushing) || deps.isUnsafe(),
      now,
    });
    const sink: PingResultSink = retry
      ? coordinator.beginFill()
      : coordinator.beginRun();
    const close = (preserve: boolean): void => {
      if (closed) return;
      closed = !preserve;
      flushing = preserve;
      try {
        // Also clears the coordinator's pending partial-persist timer.
        sink.flushPartials();
      } finally {
        closed = true;
        flushing = false;
        sinks.delete(signal);
      }
    };
    sinks.set(signal, close);
    return {
      onResult(uuid: string, latency: number | null) {
        if (!closed && !signal.aborted && !deps.isUnsafe()) {
          sink.onResult(uuid, latency);
        }
      },
      persist: sink.persist,
      close,
    };
  };

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
    await sleep(retryDelayMs, signal);
    if (signal.aborted || deps.isUnsafe()) return;

    logger.debug('PingRefresh', 'Retrying failed servers in background', {
      failed: failed.length,
      retryTimeoutMs,
    });
    const fill = beginSink(signal, true);
    try {
      const results = await deps.pingService.pingServers(
        failed,
        retryTimeoutMs,
        {
          signal,
          onResult: (uuid, latency) => {
            if (latency != null) {
              fill.onResult(uuid, latency);
            }
          },
        },
      );
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
    } finally {
      fill.close(false);
    }
  };

  const supersedeRetries = (preserve = false): void => {
    const previous = retryAbort;
    retryAbort = new AbortController();
    previous.abort();
    sinks.get(previous.signal)?.(preserve);
  };

  const abortInFlightProbes = (preserve = false): void => {
    const previous = passAbort;
    passAbort = new AbortController();
    queuedAutoRun = null;
    previous.abort();
    activeFinish?.();
    try {
      sinks.get(previous.signal)?.(preserve);
    } finally {
      supersedeRetries(preserve);
    }
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
    signal: AbortSignal,
    serverIds?: Set<string>,
  ): Promise<PingResult[]> => {
    const timer = new PerfTimer('PingRefresh', 'run');
    const catalog = deps.store.list();
    const servers =
      serverIds === undefined
        ? catalog
        : catalog.filter((server) => serverIds.has(server.uuid));
    if (signal.aborted || deps.isUnsafe()) {
      logger.debug('PingRefresh', 'Skipping ping-all while session is active', {
        trigger,
      });
      timer.end({ trigger, skipped: 'unsafe' });
      return toResults(catalog);
    }
    if (
      !force &&
      servers.length > 0 &&
      allServersHaveFreshPing(servers, minPingIntervalMs, now())
    ) {
      timer.end({ trigger, skipped: 'fresh', total: servers.length });
      return toResults(catalog);
    }
    const targets = filterServersNeedingPing(servers, {
      force,
      minPingIntervalMs,
      now: now(),
    });
    if (targets.length === 0) {
      timer.end({ trigger, skipped: 'no-targets' });
      return toResults(catalog);
    }

    // A new pass re-measures the same hosts; drop the background retry so
    // we do not open a second batch of sockets alongside it.
    supersedeRetries();
    const run = beginSink(signal);
    activeRuns += 1;
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      activeRuns -= 1;
      activeFinish = null;
    };
    activeFinish = finish;

    try {
      emitChanged(true);
      if (signal.aborted) return toResults(deps.store.list());
      const results = await deps.pingService.pingServers(
        targets,
        initialTimeoutMs,
        { onResult: run.onResult, signal },
      );
      // Flip the in-progress flag before the final persist so one snapshot
      // carries both the figures and the idle button state.
      finish();
      if (signal.aborted || deps.isUnsafe()) {
        logger.debug(
          'PingRefresh',
          'Dropping ping-all results (network state changed)',
          { trigger },
        );
        if (!signal.aborted) emitChanged(true);
        timer.end({ trigger, dropped: true });
        return toResults(deps.store.list());
      }

      let updated: VlessConfig[];
      try {
        updated = run.persist(results, { immediate: true });
      } catch (error) {
        // finish() already cleared the flag; publish that so the spinner
        // does not stay on after a failed write.
        emitChanged(true);
        throw error;
      }
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
      if (failed.length > 0 && !signal.aborted) {
        scheduleRetry(failed);
      }
      return toResults(updated);
    } finally {
      run.close(false);
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
    run({
      force,
      trigger,
      serverIds,
    }: Parameters<PingRefreshRunner['run']>[0]) {
      // Capture at enqueue time: a stopped job must not inherit a fresh signal.
      const signal = passAbort.signal;
      const selection =
        serverIds === undefined ? undefined : new Set(serverIds);
      if (force || trigger === 'user' || selection !== undefined) {
        return runQueue.enqueue(() =>
          executeRun(force, trigger, signal, selection),
        );
      }
      // Unattended passes coalesce: a second request while one is still
      // waiting for the queue joins it instead of probing twice.
      if (queuedAutoRun) {
        return queuedAutoRun;
      }
      const job = runQueue.enqueue(() => {
        if (queuedAutoRun === job) queuedAutoRun = null;
        return executeRun(false, trigger, signal);
      });
      queuedAutoRun = job;
      return job;
    },
    stop() {
      scheduler.dispose();
      try {
        abortInFlightProbes(true);
      } finally {
        emitChanged(true);
      }
    },
    isRunning() {
      return activeRuns > 0;
    },
    requestAuto(trigger: PingAutoTrigger, delayMs?: number) {
      scheduler.schedule(trigger, delayMs);
    },
    handleSessionPhase(phase: SessionPhase) {
      if (isPingUnsafePhase(phase, false)) {
        abortInFlightProbes();
      }
      scheduler.handleSessionPhase(phase);
    },
    dispose() {
      scheduler.dispose();
      abortInFlightProbes();
      emitter.removeAllListeners();
    },
  }) as PingRefreshRunner;

  return runner;
}
