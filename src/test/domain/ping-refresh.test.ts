import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VlessConfig } from '@/shared/types';
import {
  createPingAutoScheduler,
  createPingRefreshRunner,
  isPingUnsafePhase,
  type PingRefreshChange,
} from '@/main/runtime/pingRefresh';
import { makeServer } from '@/test/factories';

interface PendingProbe {
  servers: VlessConfig[];
  timeout: number;
  onResult?: (uuid: string, latency: number | null) => void;
  signal?: AbortSignal;
  resolve: (results: Map<string, number | null>) => void;
}

function createFakePingService() {
  const calls: PendingProbe[] = [];
  const pingServers = vi.fn(
    (
      servers: VlessConfig[],
      timeout: number,
      options: {
        onResult?: (uuid: string, latency: number | null) => void;
        signal?: AbortSignal;
      } = {},
    ) =>
      new Promise<Map<string, number | null>>((resolve) => {
        calls.push({
          servers,
          timeout,
          onResult: options.onResult,
          signal: options.signal,
          resolve,
        });
      }),
  );
  const complete = (
    index: number,
    latencies: Record<string, number | null>,
  ): void => {
    const call = calls[index];
    if (!call) throw new Error(`no probe call #${index}`);
    const results = new Map<string, number | null>();
    for (const server of call.servers) {
      const latency = latencies[server.uuid] ?? null;
      results.set(server.uuid, latency);
      call.onResult?.(server.uuid, latency);
    }
    call.resolve(results);
  };
  return { calls, pingServers, complete };
}

function createStore(initial: VlessConfig[]) {
  let catalog = initial;
  const store = {
    list: vi.fn(() => [...catalog]),
    saveAll: vi.fn((next: VlessConfig[]) => {
      catalog = next;
    }),
    savePings: vi.fn(
      (
        overlay: Record<
          string,
          { ping: number | null; pingTime?: number; pingStale?: boolean }
        >,
      ) => {
        catalog = catalog.map((server) =>
          overlay[server.uuid]
            ? { ...server, ...overlay[server.uuid] }
            : server,
        );
      },
    ),
  };
  return store;
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function waitFor(predicate: () => boolean, attempts = 50): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    if (predicate()) return;
    await flush();
  }
  throw new Error('condition not met');
}

describe('ping refresh runner', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function createHarness(
    servers: VlessConfig[],
    options: {
      unsafe?: () => boolean;
      now?: () => number;
      retryDelayMs?: number;
    } = {},
  ) {
    const store = createStore(servers);
    const ping = createFakePingService();
    const changes: PingRefreshChange[] = [];
    const runner = createPingRefreshRunner({
      store,
      pingService: ping,
      isUnsafe: options.unsafe ?? (() => false),
      now: options.now ?? (() => 1_000_000),
      retryDelayMs: options.retryDelayMs ?? 0,
      autoDelays: { startup: 0, 'catalog-changed': 0, 'session-idle': 0 },
    });
    runner.on('changed', (change) => changes.push(change));
    return { store, ping, runner, changes };
  }

  it('flips the in-progress flag around a pass and persists the final results', async () => {
    const { store, ping, runner, changes } = createHarness([
      makeServer({ uuid: 'a' }),
      makeServer({ uuid: 'b' }),
    ]);

    const job = runner.run({ force: true, trigger: 'user' });
    await waitFor(() => ping.calls.length === 1);
    expect(runner.isRunning()).toBe(true);
    expect(changes).toEqual([{ immediate: true }]);

    ping.complete(0, { a: 15, b: 40 });
    const results = await job;

    expect(runner.isRunning()).toBe(false);
    expect(results).toEqual([
      { uuid: 'a', latency: 15 },
      { uuid: 'b', latency: 40 },
    ]);
    expect(store.savePings).toHaveBeenCalledTimes(1);
    // The final persist both publishes the figures and clears the flag.
    expect(changes.at(-1)).toEqual({ immediate: true });
    expect(ping.calls).toHaveLength(1);
  });

  it.each([true, false])(
    'restricts stored targets to selected IDs (force=%s)',
    async (force) => {
      const untouched = makeServer({ uuid: 'other', ping: 70, pingTime: 1 });
      const { ping, runner, store } = createHarness([
        makeServer({ uuid: 'a', ping: 10, pingTime: 999_999 }),
        makeServer({ uuid: 'b' }),
        untouched,
      ]);
      const job = runner.run({
        force,
        trigger: 'user',
        serverIds: ['b', 'a', 'b', 'unknown'],
      });
      await waitFor(() => ping.calls.length === 1);
      expect(ping.calls[0].servers.map((server) => server.uuid)).toEqual(
        force ? ['a', 'b'] : ['b'],
      );
      ping.complete(0, { a: 21, b: 22 });
      expect(await job).toEqual([
        { uuid: 'a', latency: force ? 21 : 10 },
        { uuid: 'b', latency: 22 },
        { uuid: 'other', latency: 70 },
      ]);
      expect(store.list()[2]).toEqual(untouched);
      runner.dispose();
    },
  );

  it.each([true, false])(
    'probes and persists nothing for an empty selection (force=%s)',
    async (force) => {
      const { ping, runner, store, changes } = createHarness([
        makeServer({ uuid: 'a' }),
      ]);
      expect(
        await runner.run({ force, trigger: 'user', serverIds: [] }),
      ).toEqual([{ uuid: 'a', latency: null }]);
      expect(ping.pingServers).not.toHaveBeenCalled();
      expect(store.savePings).not.toHaveBeenCalled();
      expect(changes).toEqual([]);
      runner.dispose();
    },
  );

  it('stop flushes measured partials only and ignores late callbacks and results', async () => {
    vi.useFakeTimers();
    const untouched = makeServer({
      uuid: 'c',
      ping: 80,
      pingTime: 123,
      pingStale: true,
    });
    const { ping, runner, store, changes } = createHarness([
      makeServer({ uuid: 'a' }),
      makeServer({ uuid: 'b' }),
      untouched,
    ]);
    const job = runner.run({ force: true, trigger: 'user' });
    await vi.advanceTimersByTimeAsync(0);
    ping.calls[0].onResult?.('a', 12);
    ping.calls[0].onResult?.('b', null);
    expect(store.savePings).not.toHaveBeenCalled();
    runner.stop();
    expect(runner.isRunning()).toBe(false);
    expect(ping.calls[0].signal?.aborted).toBe(true);
    expect(store.list()).toEqual([
      expect.objectContaining({ uuid: 'a', ping: 12, pingTime: 1_000_000 }),
      expect.objectContaining({ uuid: 'b', ping: null, pingTime: 1_000_000 }),
      untouched,
    ]);
    const writes = store.savePings.mock.calls.length;
    const notifications = changes.length;
    ping.complete(0, { a: 999, b: 999, c: null });
    expect(await job).toEqual([
      { uuid: 'a', latency: 12 },
      { uuid: 'b', latency: null },
      { uuid: 'c', latency: 80 },
    ]);
    await vi.runAllTimersAsync();
    expect(store.savePings).toHaveBeenCalledTimes(writes);
    expect(changes).toHaveLength(notifications);
    expect(ping.calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    runner.dispose();
  });

  it('stop cancels queued explicit and auto jobs and the scheduler, but permits new requests', async () => {
    vi.useFakeTimers();
    const { ping, runner, store } = createHarness([makeServer({ uuid: 'a' })]);
    const active = runner.run({ force: true, trigger: 'user' });
    await vi.advanceTimersByTimeAsync(0);
    const queued = runner.run({ force: true, trigger: 'user' });
    runner.requestAuto('startup');
    await vi.advanceTimersByTimeAsync(0);
    const queuedAuto = runner.run({ force: false, trigger: 'catalog-changed' });
    runner.requestAuto('session-idle', 1000);
    runner.stop();
    expect(vi.getTimerCount()).toBe(0);
    const newAuto = runner.run({ force: false, trigger: 'startup' });
    expect(newAuto).not.toBe(queuedAuto);
    ping.complete(0, { a: null });
    await Promise.all([active, queued, queuedAuto]);
    await vi.advanceTimersByTimeAsync(0);
    expect(ping.calls).toHaveLength(2);
    expect(store.savePings).not.toHaveBeenCalled();
    expect(ping.calls[1].signal?.aborted).toBe(false);
    ping.complete(1, { a: 10 });
    await newAuto;
    await vi.advanceTimersByTimeAsync(2000);
    expect(ping.calls).toHaveLength(2);
    const explicit = runner.run({ force: true, trigger: 'user' });
    await vi.advanceTimersByTimeAsync(0);
    ping.complete(2, { a: 11 });
    await explicit;
    runner.stop();
    // A later state-driven request is still allowed (no persistent disable).
    store.saveAll([makeServer({ uuid: 'a' })]);
    runner.requestAuto('catalog-changed');
    await vi.advanceTimersByTimeAsync(0);
    expect(ping.calls).toHaveLength(4);
    ping.complete(3, { a: 12 });
    await vi.runAllTimersAsync();
    runner.dispose();
  });

  it('stop clears a pending retry delay', async () => {
    vi.useFakeTimers();
    const { ping, runner, store } = createHarness([makeServer({ uuid: 'a' })], {
      retryDelayMs: 1000,
    });
    const job = runner.run({ force: true, trigger: 'user' });
    await vi.advanceTimersByTimeAsync(0);
    ping.complete(0, { a: null });
    await job;
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    runner.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.runAllTimersAsync();
    expect(ping.calls).toHaveLength(1);
    expect(store.savePings).toHaveBeenCalledTimes(1);
    runner.dispose();
  });

  it('stop preserves retry recoveries and blocks late retry callbacks and queued retries', async () => {
    vi.useFakeTimers();
    const { ping, runner, store, changes } = createHarness([
      makeServer({ uuid: 'a' }),
      makeServer({ uuid: 'b' }),
    ]);
    const first = runner.run({ force: true, trigger: 'user' });
    await vi.advanceTimersByTimeAsync(0);
    ping.complete(0, { a: null, b: null });
    await first;
    await vi.advanceTimersByTimeAsync(1);
    const retry = ping.calls[1];
    retry.onResult?.('a', 25);
    runner.stop();
    expect(retry.signal?.aborted).toBe(true);
    expect(store.list()[0].ping).toBe(25);
    expect(vi.getTimerCount()).toBe(0);
    const writes = store.savePings.mock.calls.length;
    const notifications = changes.length;
    retry.onResult?.('b', 999);
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.savePings).toHaveBeenCalledTimes(writes);
    expect(changes).toHaveLength(notifications);

    // The old retry still holds the queue while a new pass queues its retry.
    const second = runner.run({ force: true, trigger: 'user' });
    await vi.advanceTimersByTimeAsync(0);
    ping.complete(2, { a: 26, b: null });
    await second;
    runner.stop();
    ping.complete(1, { a: 999, b: 999 });
    await vi.runAllTimersAsync();
    expect(ping.calls).toHaveLength(3);
    expect(store.list().map((server) => server.ping)).toEqual([26, null]);
    expect(store.savePings).toHaveBeenCalledTimes(writes + 1);
    runner.dispose();
  });

  it('unsafe abort discards buffered partials even after returning to a safe phase', async () => {
    vi.useFakeTimers();
    let unsafe = false;
    const { ping, runner, store } = createHarness([makeServer({ uuid: 'a' })], {
      unsafe: () => unsafe,
    });
    const job = runner.run({ force: true, trigger: 'user' });
    await vi.advanceTimersByTimeAsync(0);
    ping.calls[0].onResult?.('a', 5);
    unsafe = true;
    runner.handleSessionPhase('connecting');
    unsafe = false;
    runner.stop();
    ping.complete(0, { a: 6 });
    await job;
    await vi.runAllTimersAsync();
    expect(store.savePings).not.toHaveBeenCalled();
    expect(runner.isRunning()).toBe(false);
    runner.dispose();
  });

  it('retries failed rows in the background without blocking the next pass', async () => {
    const { ping, runner, store } = createHarness([
      makeServer({ uuid: 'a' }),
      makeServer({ uuid: 'b' }),
    ]);

    const first = runner.run({ force: true, trigger: 'user' });
    await waitFor(() => ping.calls.length === 1);
    ping.complete(0, { a: 20, b: null });
    await first;

    await waitFor(() => ping.calls.length === 2);
    const retry = ping.calls[1]!;
    expect(retry.servers.map((server) => server.uuid)).toEqual(['b']);
    expect(retry.timeout).toBeGreaterThan(ping.calls[0]!.timeout);

    // The user presses the button while the retry is still probing.
    const second = runner.run({ force: true, trigger: 'user' });
    await waitFor(() => ping.calls.length === 3);
    expect(retry.signal?.aborted).toBe(true);

    ping.complete(2, { a: 21, b: 33 });
    ping.complete(1, { b: 999 });
    await second;

    const overlay = store.savePings.mock.calls.at(-1)?.[0];
    expect(overlay.b.ping).toBe(33);
  });

  it('aborts a background retry when a new unattended pass starts', async () => {
    const now = 1_000_000;
    const { ping, runner } = createHarness(
      [
        makeServer({ uuid: 'a', ping: 10, pingTime: now - 60_000 }),
        makeServer({ uuid: 'b', ping: 11, pingTime: now - 60_000 }),
      ],
      { now: () => now },
    );

    const first = runner.run({ force: true, trigger: 'user' });
    await waitFor(() => ping.calls.length === 1);
    ping.complete(0, { a: 20, b: null });
    await first;

    await waitFor(() => ping.calls.length === 2);
    const retry = ping.calls[1]!;

    const second = runner.run({ force: false, trigger: 'catalog-changed' });
    await waitFor(() => ping.calls.length === 3);
    expect(retry.signal?.aborted).toBe(true);

    ping.complete(2, { b: 33 });
    ping.complete(1, { b: 999 });
    await second;
  });

  it('lets a retry fill a row that is still empty', async () => {
    const { ping, runner, store } = createHarness([
      makeServer({ uuid: 'a' }),
      makeServer({ uuid: 'b' }),
    ]);

    const job = runner.run({ force: true, trigger: 'user' });
    await waitFor(() => ping.calls.length === 1);
    ping.complete(0, { a: 20, b: null });
    await job;

    await waitFor(() => ping.calls.length === 2);
    ping.complete(1, { b: 310 });
    await waitFor(() => store.savePings.mock.calls.length === 2);

    const overlay = store.savePings.mock.calls.at(-1)?.[0];
    expect(overlay.b).toMatchObject({ ping: 310, pingStale: false });
    expect(overlay.a).toMatchObject({ ping: 20 });
  });

  it('probes only rows lacking a fresh latency on an unattended pass', async () => {
    const now = 1_000_000;
    const { ping, runner } = createHarness(
      [
        makeServer({ uuid: 'fresh', ping: 10, pingTime: now - 1000 }),
        makeServer({
          uuid: 'stale',
          ping: 12,
          pingTime: now - 1000,
          pingStale: true,
        }),
        makeServer({ uuid: 'never' }),
        makeServer({ uuid: 'old', ping: 30, pingTime: now - 60_000 }),
      ],
      { now: () => now },
    );

    const job = runner.run({ force: false, trigger: 'startup' });
    await waitFor(() => ping.calls.length === 1);
    expect(ping.calls[0]!.servers.map((server) => server.uuid)).toEqual([
      'stale',
      'never',
      'old',
    ]);
    ping.complete(0, { stale: 1, never: 2, old: 3 });
    await job;
  });

  it('skips an unattended pass entirely when every row is fresh', async () => {
    const now = 1_000_000;
    const { ping, runner, changes } = createHarness(
      [makeServer({ uuid: 'a', ping: 10, pingTime: now - 100 })],
      { now: () => now },
    );

    const results = await runner.run({
      force: false,
      trigger: 'catalog-changed',
    });

    expect(ping.pingServers).not.toHaveBeenCalled();
    expect(results).toEqual([{ uuid: 'a', latency: 10 }]);
    expect(changes).toEqual([]);
  });

  it('re-probes a row whose last measurement was null even if pingTime is recent', async () => {
    const now = 1_000_000;
    const { ping, runner } = createHarness(
      [makeServer({ uuid: 'dead', ping: null, pingTime: now - 100 })],
      { now: () => now },
    );

    const job = runner.run({ force: false, trigger: 'startup' });
    await waitFor(() => ping.calls.length === 1);
    expect(ping.calls[0]!.servers.map((server) => server.uuid)).toEqual([
      'dead',
    ]);
    ping.complete(0, { dead: 18 });
    await job;
  });

  it('drops the pass when a session takes the stack mid-probe', async () => {
    let unsafe = false;
    const { ping, runner, store } = createHarness([makeServer({ uuid: 'a' })], {
      unsafe: () => unsafe,
    });

    const job = runner.run({ force: true, trigger: 'user' });
    await waitFor(() => ping.calls.length === 1);
    unsafe = true;
    ping.complete(0, { a: 5 });
    await job;

    expect(store.savePings).not.toHaveBeenCalled();
    expect(runner.isRunning()).toBe(false);
    // No retry is scheduled for a dropped pass.
    await flush();
    expect(ping.calls).toHaveLength(1);
  });

  it('clears the in-progress flag when persist throws', async () => {
    const { ping, runner, store, changes } = createHarness([
      makeServer({ uuid: 'a' }),
    ]);
    store.savePings.mockImplementation(() => {
      throw new Error('disk full');
    });

    const job = runner.run({ force: true, trigger: 'user' });
    await waitFor(() => ping.calls.length === 1);
    ping.complete(0, { a: 4 });
    await expect(job).rejects.toThrow('disk full');

    expect(runner.isRunning()).toBe(false);
    expect(changes).toHaveLength(2);
    expect(changes.at(-1)).toEqual({ immediate: true });
  });

  it('aborts in-flight probes when a session starts connecting', async () => {
    let unsafe = false;
    const { ping, runner, store } = createHarness([makeServer({ uuid: 'a' })], {
      unsafe: () => unsafe,
    });

    const job = runner.run({ force: true, trigger: 'user' });
    await waitFor(() => ping.calls.length === 1);

    unsafe = true;
    runner.handleSessionPhase('connecting');
    expect(ping.calls[0]!.signal?.aborted).toBe(true);

    ping.complete(0, { a: 5 });
    await job;

    expect(store.savePings).not.toHaveBeenCalled();
    expect(runner.isRunning()).toBe(false);
  });

  it('coalesces overlapping unattended requests into one queued pass', async () => {
    const { ping, runner } = createHarness([makeServer({ uuid: 'a' })]);

    runner.requestAuto('startup');
    runner.requestAuto('catalog-changed');
    await waitFor(() => ping.calls.length === 1);
    await flush();
    await flush();

    expect(ping.calls).toHaveLength(1);
    ping.complete(0, { a: 9 });
  });

  it('re-measures after a session returns to idle', async () => {
    const now = 1_000_000;
    const { ping, runner } = createHarness(
      [makeServer({ uuid: 'a', ping: 10, pingTime: now - 120_000 })],
      { now: () => now },
    );

    runner.handleSessionPhase('connecting');
    runner.handleSessionPhase('connected');
    await flush();
    expect(ping.pingServers).not.toHaveBeenCalled();

    runner.handleSessionPhase('disconnecting');
    runner.handleSessionPhase('idle');
    await waitFor(() => ping.calls.length === 1);
    ping.complete(0, { a: 11 });
  });
});

describe('ping auto scheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the earliest pending request and drops later ones', () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => undefined);
    const scheduler = createPingAutoScheduler({ run, isUnsafe: () => false });

    scheduler.schedule('catalog-changed');
    scheduler.schedule('startup');
    vi.advanceTimersByTime(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('startup');

    vi.advanceTimersByTime(5000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('re-arms to an earlier deadline when a sooner trigger arrives', () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => undefined);
    const scheduler = createPingAutoScheduler({ run, isUnsafe: () => false });

    scheduler.schedule('session-idle');
    vi.advanceTimersByTime(500);
    scheduler.schedule('catalog-changed', 100);
    vi.advanceTimersByTime(100);
    expect(run).toHaveBeenCalledWith('catalog-changed');
    vi.advanceTimersByTime(2000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not probe while a session is active', () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => undefined);
    const scheduler = createPingAutoScheduler({ run, isUnsafe: () => true });

    scheduler.schedule('startup');
    vi.advanceTimersByTime(0);
    expect(run).not.toHaveBeenCalled();
  });

  it('schedules only on a transition into a settled phase', () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => undefined);
    const scheduler = createPingAutoScheduler({ run, isUnsafe: () => false });

    scheduler.handleSessionPhase('idle');
    vi.advanceTimersByTime(5000);
    expect(run).not.toHaveBeenCalled();

    scheduler.handleSessionPhase('connecting');
    scheduler.handleSessionPhase('failed');
    vi.advanceTimersByTime(1500);
    expect(run).toHaveBeenCalledWith('session-idle');
  });

  it('dispose cancels a pending request', () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => undefined);
    const scheduler = createPingAutoScheduler({ run, isUnsafe: () => false });

    scheduler.schedule('catalog-changed');
    scheduler.dispose();
    vi.advanceTimersByTime(5000);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('isPingUnsafePhase', () => {
  it('treats connected and in-flight connect phases as unsafe', () => {
    expect(isPingUnsafePhase('connected', false)).toBe(true);
    expect(isPingUnsafePhase('connecting', false)).toBe(true);
    expect(isPingUnsafePhase('switching', false)).toBe(true);
    expect(isPingUnsafePhase('idle', true)).toBe(true);
    expect(isPingUnsafePhase('idle', false)).toBe(false);
    expect(isPingUnsafePhase('failed', false)).toBe(false);
    expect(isPingUnsafePhase('disconnecting', false)).toBe(false);
  });
});
