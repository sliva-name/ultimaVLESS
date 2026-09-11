import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAppStore } from '@/main/infrastructure/persistence/appStore';
import { createServerRepository } from '@/main/infrastructure/persistence/ElectronServerRepository';
import { createSubscriptionRepository } from '@/main/infrastructure/persistence/ElectronSubscriptionRepository';
import { makeServer, makeSubscription } from '@/test/factories';

/**
 * `electron-store` parses the whole JSON file on every `get()`. The
 * repositories are the only in-process writers of their keys, so they must
 * serve repeated reads from memory and only re-read after their own writes.
 */
describe('repository read caching over electron-store', () => {
  const store = getAppStore();
  const getMock = store.get as unknown as ReturnType<typeof vi.fn>;
  let data: Record<string, unknown>;

  beforeEach(() => {
    data = {
      servers: [makeServer({ uuid: 'a' }), makeServer({ uuid: 'b' })],
      serverPings: { a: { ping: 42, pingTime: 1 } },
      subscriptions: [makeSubscription()],
      manualLinksInput: 'vless://x',
    };
    getMock.mockReset();
    getMock.mockImplementation((key: string) => data[key]);
    (store.set as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  it('reads the server catalog from disk once for repeated list()/get() calls', () => {
    const repository = createServerRepository();

    repository.list();
    repository.list();
    repository.get('a');

    const catalogReads = getMock.mock.calls.filter(
      ([key]) => key === 'servers',
    );
    expect(catalogReads).toHaveLength(1);
    expect(repository.get('a')).toMatchObject({ uuid: 'a', ping: 42 });
  });

  it('returns a fresh array so callers cannot mutate the cache', () => {
    const repository = createServerRepository();

    const first = repository.list();
    first.pop();

    expect(repository.list()).toHaveLength(2);
  });

  it('re-reads only the ping overlay after savePings and everything after saveAll', () => {
    const repository = createServerRepository();
    repository.list();
    getMock.mockClear();

    repository.savePings!({ a: { ping: 7, pingTime: 2 } });
    repository.list();
    expect(getMock.mock.calls.map(([key]) => key)).toEqual(['serverPings']);

    getMock.mockClear();
    repository.saveAll([makeServer({ uuid: 'c' })]);
    repository.list();
    expect(getMock.mock.calls.map(([key]) => key)).toEqual(
      expect.arrayContaining(['servers', 'serverPings']),
    );
  });

  it('serves subscriptions and manual links from memory after the first read', () => {
    const repository = createSubscriptionRepository();

    repository.list();
    repository.list();
    repository.getManualLinks();
    repository.getManualLinks();

    expect(getMock.mock.calls.map(([key]) => key)).toEqual([
      'subscriptions',
      'manualLinksInput',
    ]);

    const added = repository.add({
      name: 'New',
      url: 'https://x',
      enabled: true,
    });
    expect(repository.list().map((sub) => sub.id)).toContain(added.id);
    repository.setManualLinks('vless://y');
    expect(repository.getManualLinks()).toBe('vless://y');
  });
});
