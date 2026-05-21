import { describe, expect, it } from 'vitest';
import {
  allServersHaveFreshPing,
  filterServersNeedingPing,
} from './pingFilters';
import type { VlessConfig } from './types';

function makeServer(partial: Partial<VlessConfig>): VlessConfig {
  return {
    uuid: 'u1',
    address: '1.1.1.1',
    port: 443,
    name: 'Test',
    ...partial,
  };
}

describe('pingFilters', () => {
  it('returns all servers when force is true', () => {
    const servers = [
      makeServer({ uuid: 'a', pingTime: Date.now() }),
      makeServer({ uuid: 'b', pingTime: Date.now() }),
    ];
    expect(filterServersNeedingPing(servers, { force: true })).toHaveLength(2);
  });

  it('filters to stale and missing ping only when not forced', () => {
    const now = 100_000;
    const servers = [
      makeServer({ uuid: 'fresh', pingTime: now - 1000 }),
      makeServer({ uuid: 'stale', pingTime: now - 60_000 }),
      makeServer({ uuid: 'missing', pingTime: 0 }),
      makeServer({ uuid: 'flag', pingTime: now - 1000, pingStale: true }),
    ];
    const targets = filterServersNeedingPing(servers, {
      force: false,
      now,
      minPingIntervalMs: 30_000,
    });
    expect(targets.map((s) => s.uuid).sort()).toEqual(
      ['flag', 'missing', 'stale'].sort(),
    );
  });

  it('detects when every server has fresh ping', () => {
    const now = 50_000;
    const servers = [
      makeServer({ uuid: 'a', pingTime: now - 5000 }),
      makeServer({ uuid: 'b', pingTime: now - 10_000 }),
    ];
    expect(allServersHaveFreshPing(servers, 30_000, now)).toBe(true);
    expect(
      allServersHaveFreshPing(
        [...servers, makeServer({ uuid: 'c', pingStale: true, pingTime: now })],
        30_000,
        now,
      ),
    ).toBe(false);
  });
});
