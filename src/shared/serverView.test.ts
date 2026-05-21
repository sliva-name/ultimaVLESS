import { describe, expect, it } from 'vitest';
import { getServerProtocolLabel, sortByPingAvailability } from './serverView';
import type { VlessConfig } from './types';

describe('getServerProtocolLabel', () => {
  it('returns protocol-specific labels', () => {
    expect(getServerProtocolLabel({ protocol: 'trojan', security: 'tls' })).toBe(
      'TROJAN',
    );
    expect(
      getServerProtocolLabel({ protocol: 'shadowsocks', security: 'tls' }),
    ).toBe('SHADOWSOCKS');
    expect(getServerProtocolLabel({ security: 'reality' })).toBe('REALITY');
    expect(getServerProtocolLabel({ security: 'tls' })).toBe('VLESS');
    expect(getServerProtocolLabel({})).toBe('VLESS');
  });
});

describe('sortByPingAvailability', () => {
  const server = (uuid: string, ping?: number | null): VlessConfig => ({
    uuid,
    address: 'example.com',
    port: 443,
    name: uuid,
    ping,
  });

  it('sorts measured pings ascending and pushes unknown pings to the end', () => {
    const sorted = sortByPingAvailability([
      server('c', null),
      server('a', 120),
      server('b', 40),
      server('d'),
    ]);

    expect(sorted.map((item) => item.uuid)).toEqual(['b', 'a', 'c', 'd']);
  });
});
