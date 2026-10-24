import { describe, expect, it } from 'vitest';
import { createTunInbound } from '@/main/services/configGenerator/inbounds';
import { isLinuxIpv6Available } from '@/main/services/tunRoute/linuxIpv6';

type TunSettings = { gateway: string[]; autoSystemRoutingTable?: string[] };

describe('Linux IPv6 availability', () => {
  const sysctl =
    (values: Record<string, string>) =>
    (path: string): string => {
      const scope = /conf\/(\w+)\/disable_ipv6$/.exec(path)?.[1] ?? '';
      if (!(scope in values)) throw new Error('ENOENT');
      return `${values[scope]}\n`;
    };

  it('is unavailable on a kernel without IPv6', () => {
    expect(isLinuxIpv6Available(sysctl({}), () => false)).toBe(false);
  });

  it('is unavailable when sysctl disables IPv6', () => {
    expect(
      isLinuxIpv6Available(sysctl({ all: '0', default: '1' }), () => true),
    ).toBe(false);
    expect(
      isLinuxIpv6Available(sysctl({ all: '1', default: '0' }), () => true),
    ).toBe(false);
  });

  it('is available otherwise', () => {
    expect(
      isLinuxIpv6Available(sysctl({ all: '0', default: '0' }), () => true),
    ).toBe(true);
    expect(isLinuxIpv6Available(sysctl({}), () => true)).toBe(true);
  });
});

describe('TUN inbound without IPv6', () => {
  it('drops the IPv6 gateway and ::/0', () => {
    const settings = createTunInbound({ tunAutoRoute: true, ipv6: false })
      .settings as TunSettings;
    expect(settings.gateway).toEqual(['172.19.0.1/30']);
    expect(settings.autoSystemRoutingTable).toEqual(['0.0.0.0/0']);
  });

  it('keeps both families by default', () => {
    const settings = createTunInbound({ tunAutoRoute: true })
      .settings as TunSettings;
    expect(settings.gateway).toHaveLength(2);
    expect(settings.autoSystemRoutingTable).toEqual(['0.0.0.0/0', '::/0']);
  });
});

describe('TUN routes on Linux', () => {
  it('routes the two /1 halves so a metric-0 default route cannot win', () => {
    const settings = createTunInbound({
      tunAutoRoute: true,
      splitDefaultRoute: true,
    }).settings as TunSettings;
    expect(settings.autoSystemRoutingTable).toEqual([
      '0.0.0.0/1',
      '128.0.0.0/1',
      '::/1',
      '8000::/1',
    ]);
  });

  it('splits IPv4 only when the TUN has no IPv6', () => {
    const settings = createTunInbound({
      tunAutoRoute: true,
      splitDefaultRoute: true,
      ipv6: false,
    }).settings as TunSettings;
    expect(settings.autoSystemRoutingTable).toEqual([
      '0.0.0.0/1',
      '128.0.0.0/1',
    ]);
  });
});
