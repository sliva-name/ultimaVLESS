import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPingResultSink,
  extractPingOverlay,
  mergePingResults,
  PING_PARTIAL_BATCH_SIZE,
  PING_PARTIAL_DEBOUNCE_MS,
} from '@/main/ipc/pingResultSink';
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

describe('ping result sink', () => {
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
    const run = createPingResultSink({
      store,
      notifySnapshot,
      isUnsafe: () => false,
      now: () => 1000,
    });
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
    const run = createPingResultSink({
      store,
      notifySnapshot,
      isUnsafe: () => false,
      now: () => 42,
    });
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

  it('applies results to a catalog refreshed mid-run by uuid and skips vanished rows', () => {
    const store = createStore();
    const notifySnapshot = vi.fn();
    const run = createPingResultSink({
      store,
      notifySnapshot,
      isUnsafe: () => false,
      now: () => 7,
    });

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
    const run = createPingResultSink({
      store,
      notifySnapshot: vi.fn(),
      isUnsafe: () => unsafe,
    });
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
    const run = createPingResultSink({
      store,
      notifySnapshot: vi.fn(),
      isUnsafe: () => false,
      now: () => 1,
    });
    for (let index = 0; index < PING_PARTIAL_BATCH_SIZE; index += 1) {
      run.onResult(`s-${index}`, index);
    }
    expect(store.savePings).toHaveBeenCalledTimes(1);
  });

  it('background fill only writes rows still lacking a latency', () => {
    const store = createStore([
      makeServer({ uuid: 'a', ping: null, pingTime: 3 }),
      makeServer({ uuid: 'b', ping: 12, pingTime: 3 }),
    ]);
    const fill = createPingResultSink({
      store,
      notifySnapshot: vi.fn(),
      isUnsafe: () => false,
      onlyMissing: true,
      now: () => 9,
    });

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
