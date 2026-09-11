import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPingAllCoordinator,
  extractPingOverlay,
  mergePingResults,
  PING_PARTIAL_BATCH_SIZE,
  PING_PARTIAL_DEBOUNCE_MS,
} from '@/main/ipc/pingAllCoordinator';
import { makeServer } from '@/test/factories';

function createStore(
  servers = [makeServer({ uuid: 'a' }), makeServer({ uuid: 'b' })],
) {
  let catalog = servers;
  return {
    list: vi.fn(() => catalog),
    saveAll: vi.fn((next: typeof catalog) => {
      catalog = next;
    }),
    savePings: vi.fn(),
    get catalog() {
      return catalog;
    },
    set catalog(next: typeof catalog) {
      catalog = next;
    },
  };
}

describe('ping-all coordinator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('merges ping overlay without rewriting unrelated servers', () => {
    const servers = [
      makeServer({ uuid: 'a', ping: 10, pingTime: 1 }),
      makeServer({ uuid: 'b', ping: 20, pingTime: 1 }),
    ];
    const merged = mergePingResults(servers, new Map([['b', 55]]), 9);
    expect(merged[0]).toMatchObject({ uuid: 'a', ping: 10, pingTime: 1 });
    expect(merged[1]).toMatchObject({
      uuid: 'b',
      ping: 55,
      pingTime: 9,
      pingStale: false,
    });
    expect(extractPingOverlay(merged).b).toMatchObject({
      ping: 55,
      pingTime: 9,
    });
  });

  it('with onlyMissing keeps rows that already have a latency', () => {
    const servers = [
      makeServer({ uuid: 'a', ping: 10, pingTime: 5 }),
      makeServer({ uuid: 'b', ping: null, pingTime: 5 }),
    ];
    const merged = mergePingResults(
      servers,
      new Map([
        ['a', 99],
        ['b', 77],
      ]),
      9,
      { onlyMissing: true },
    );
    expect(merged[0]).toMatchObject({ uuid: 'a', ping: 10, pingTime: 5 });
    expect(merged[1]).toMatchObject({ uuid: 'b', ping: 77, pingTime: 9 });
  });

  it('debounces partial persist and writes only the ping overlay', () => {
    vi.useFakeTimers();
    const store = createStore();
    const notifySnapshot = vi.fn();
    const coordinator = createPingAllCoordinator({
      store,
      notifySnapshot,
      isUnsafe: () => false,
      now: () => 1000,
    });

    const run = coordinator.beginRun();
    run.onResult('a', 12);
    expect(store.savePings).not.toHaveBeenCalled();
    expect(store.saveAll).not.toHaveBeenCalled();

    vi.advanceTimersByTime(PING_PARTIAL_DEBOUNCE_MS);
    expect(store.savePings).toHaveBeenCalledTimes(1);
    expect(store.saveAll).not.toHaveBeenCalled();
    expect(notifySnapshot).toHaveBeenCalledWith('ping', { immediate: false });
  });

  it('flushes immediately on the final persist of a run', () => {
    const store = createStore();
    const notifySnapshot = vi.fn();
    const coordinator = createPingAllCoordinator({
      store,
      notifySnapshot,
      isUnsafe: () => false,
      now: () => 42,
    });
    const run = coordinator.beginRun();
    run.onResult('a', 11);
    const updated = run.persist(
      new Map([
        ['a', 11],
        ['b', 22],
      ]),
      {
        immediate: true,
      },
    );
    expect(store.savePings).toHaveBeenCalledTimes(1);
    expect(notifySnapshot).toHaveBeenLastCalledWith('ping', {
      immediate: true,
    });
    expect(updated.map((server) => server.ping)).toEqual([11, 22]);
  });

  it('does not let a superseded run overwrite a newer ping generation', () => {
    const store = createStore();
    const notifySnapshot = vi.fn();
    const coordinator = createPingAllCoordinator({
      store,
      notifySnapshot,
      isUnsafe: () => false,
      now: () => 5000,
    });

    const first = coordinator.beginRun();
    first.persist(new Map([['a', 80]]), { immediate: true });
    expect(store.savePings).toHaveBeenCalledTimes(1);

    const second = coordinator.beginRun();
    second.persist(new Map([['a', 15]]), { immediate: true });
    expect(store.savePings).toHaveBeenCalledTimes(2);
    const latestOverlay = store.savePings.mock.calls.at(-1)?.[0];
    expect(latestOverlay.a.ping).toBe(15);

    first.persist(new Map([['a', 999]]), { immediate: true });
    expect(store.savePings).toHaveBeenCalledTimes(2);
    expect(store.savePings.mock.calls.at(-1)?.[0].a.ping).toBe(15);
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
  });

  it('applies results to a catalog refreshed mid-run by uuid and skips vanished rows', () => {
    const store = createStore();
    const notifySnapshot = vi.fn();
    const coordinator = createPingAllCoordinator({
      store,
      notifySnapshot,
      isUnsafe: () => false,
      now: () => 7,
    });
    const run = coordinator.beginRun();

    // A subscription refresh dropped `b` and added `c` while probes ran.
    store.catalog = [makeServer({ uuid: 'a' }), makeServer({ uuid: 'c' })];
    const merged = run.persist(
      new Map([
        ['a', 31],
        ['b', 45],
      ]),
      { immediate: true },
    );

    expect(store.savePings).toHaveBeenCalledTimes(1);
    expect(merged.map((server) => [server.uuid, server.ping ?? null])).toEqual([
      ['a', 31],
      ['c', null],
    ]);
    expect(store.savePings.mock.calls[0]?.[0]).toEqual({
      a: { ping: 31, pingTime: 7, pingStale: false },
    });
  });

  it('drops persist while a session holds the network stack', () => {
    const store = createStore();
    let unsafe = false;
    const coordinator = createPingAllCoordinator({
      store,
      notifySnapshot: vi.fn(),
      isUnsafe: () => unsafe,
    });
    const run = coordinator.beginRun();
    unsafe = true;
    run.persist(new Map([['a', 1]]), { immediate: true });
    expect(store.savePings).not.toHaveBeenCalled();
  });

  it('flushes a partial batch without waiting for the debounce window', () => {
    const store = createStore(
      Array.from({ length: PING_PARTIAL_BATCH_SIZE }, (_, index) =>
        makeServer({ uuid: `s-${index}` }),
      ),
    );
    const coordinator = createPingAllCoordinator({
      store,
      notifySnapshot: vi.fn(),
      isUnsafe: () => false,
      now: () => 1,
    });
    const run = coordinator.beginRun();
    for (let index = 0; index < PING_PARTIAL_BATCH_SIZE; index += 1) {
      run.onResult(`s-${index}`, index);
    }
    expect(store.savePings).toHaveBeenCalledTimes(1);
  });

  it('background fill only writes rows still lacking a latency and ignores generations', () => {
    const store = createStore([
      makeServer({ uuid: 'a', ping: null, pingTime: 3 }),
      makeServer({ uuid: 'b', ping: 12, pingTime: 3 }),
    ]);
    const coordinator = createPingAllCoordinator({
      store,
      notifySnapshot: vi.fn(),
      isUnsafe: () => false,
      now: () => 9,
    });
    const fill = coordinator.beginFill();
    // A newer foreground run starts in between — the fill must still land.
    coordinator.beginRun();

    const merged = fill.persist(
      new Map([
        ['a', 210],
        ['b', 400],
      ]),
      { immediate: true },
    );

    expect(store.savePings).toHaveBeenCalledTimes(1);
    expect(merged.find((server) => server.uuid === 'a')).toMatchObject({
      ping: 210,
      pingTime: 9,
      pingStale: false,
    });
    expect(merged.find((server) => server.uuid === 'b')).toMatchObject({
      ping: 12,
      pingTime: 3,
    });
  });
});
