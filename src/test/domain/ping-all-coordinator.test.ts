import { describe, expect, it, vi } from 'vitest';
import {
  createPingAllCoordinator,
  extractPingOverlay,
  mergePingResults,
  PING_PARTIAL_BATCH_SIZE,
  PING_PARTIAL_DEBOUNCE_MS,
} from '@/main/ipc/pingAllCoordinator';
import { makeServer } from '@/test/factories';

function createStore(servers = [makeServer({ uuid: 'a' }), makeServer({ uuid: 'b' })]) {
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
  };
}

describe('ping-all coordinator', () => {
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
    expect(extractPingOverlay(merged).b).toMatchObject({ ping: 55, pingTime: 9 });
  });

  it('debounces partial persist and writes only the ping overlay', () => {
    vi.useFakeTimers();
    const store = createStore();
    const notifySnapshot = vi.fn();
    const scheduled: Array<{ cb: () => void; ms: number }> = [];
    const coordinator = createPingAllCoordinator({
      store,
      notifySnapshot,
      isUnsafe: () => false,
      now: () => 1000,
      schedule: (cb, ms) => {
        scheduled.push({ cb, ms });
        return setTimeout(cb, ms);
      },
      cancelSchedule: (handle) => clearTimeout(handle),
    });

    const run = coordinator.beginRun(store.catalog);
    run.onResult('a', 12);
    expect(store.savePings).not.toHaveBeenCalled();
    expect(store.saveAll).not.toHaveBeenCalled();

    vi.advanceTimersByTime(PING_PARTIAL_DEBOUNCE_MS);
    expect(store.savePings).toHaveBeenCalledTimes(1);
    expect(store.saveAll).not.toHaveBeenCalled();
    expect(notifySnapshot).toHaveBeenCalledWith('ping', { immediate: false });
    expect(scheduled[0]?.ms).toBe(PING_PARTIAL_DEBOUNCE_MS);
    vi.useRealTimers();
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
    const run = coordinator.beginRun(store.catalog);
    run.onResult('a', 11);
    const updated = run.persist(new Map([['a', 11], ['b', 22]]), {
      immediate: true,
    });
    expect(store.savePings).toHaveBeenCalledTimes(1);
    expect(notifySnapshot).toHaveBeenLastCalledWith('ping', { immediate: true });
    expect(updated.map((server) => server.ping)).toEqual([11, 22]);
  });

  it('does not let a stale retry overwrite a newer ping generation', () => {
    const store = createStore();
    const notifySnapshot = vi.fn();
    const coordinator = createPingAllCoordinator({
      store,
      notifySnapshot,
      isUnsafe: () => false,
      now: () => 5000,
    });

    const first = coordinator.beginRun(store.catalog);
    first.persist(new Map([['a', 80]]), { immediate: true });
    expect(store.savePings).toHaveBeenCalledTimes(1);

    const second = coordinator.beginRun(store.catalog);
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

  it('drops persist when the catalog identity changed', () => {
    const store = createStore();
    const coordinator = createPingAllCoordinator({
      store,
      notifySnapshot: vi.fn(),
      isUnsafe: () => false,
    });
    const run = coordinator.beginRun(store.catalog);
    store.list.mockReturnValue([makeServer({ uuid: 'changed', address: '1.1.1.1' })]);
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
    const run = coordinator.beginRun(store.catalog);
    for (let index = 0; index < PING_PARTIAL_BATCH_SIZE; index += 1) {
      run.onResult(`s-${index}`, index);
    }
    expect(store.savePings).toHaveBeenCalledTimes(1);
  });
});
