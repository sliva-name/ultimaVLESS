import { describe, expect, it } from 'vitest';
import { DEFAULT_PERFORMANCE_SETTINGS } from '@/shared/types';
import type { XrayConfig } from '@/shared/xray-types';
import { TUN_IPV6_ADDRESS } from '@/main/services/tunRoute/constants';
import {
  adaptConfigForAndroid,
  buildVpnOptions,
  planAndroidRouting,
} from '../src/backend/androidConfig';

const perf = DEFAULT_PERFORMANCE_SETTINGS;

describe('planAndroidRouting', () => {
  it('sends direct apps past the VPN and drops Xray process rules', () => {
    const plan = planAndroidRouting(
      { ...perf, directApps: ['com.bank.app'] },
      'tun',
    );
    expect(plan.disallowedApps).toEqual(['com.bank.app']);
    expect(plan.allowedApps).toEqual([]);
    expect(plan.performanceSettings.directApps).toEqual([]);
    expect(plan.performanceSettings.tcpFastOpen).toBe(false);
  });

  it('lets only the chosen apps into the VPN in apps mode', () => {
    const plan = planAndroidRouting(
      {
        ...perf,
        routingMode: 'apps',
        proxyApps: ['org.telegram.messenger', 'com.bank.app'],
        directApps: ['com.bank.app'],
      },
      'tun',
    );
    expect(plan.allowedApps).toEqual(['org.telegram.messenger']);
    expect(plan.disallowedApps).toEqual([]);
    expect(plan.performanceSettings.routingMode).toBe('all');
    expect(plan.performanceSettings.proxyApps).toEqual([]);
  });

  it('keeps apps mode with an empty list sending everything direct', () => {
    const plan = planAndroidRouting({ ...perf, routingMode: 'apps' }, 'tun');
    expect(plan.allowedApps).toEqual([]);
    expect(plan.performanceSettings.routingMode).toBe('apps');
  });

  it('proxies everything sent to the local proxy in proxy-only mode', () => {
    const plan = planAndroidRouting(
      { ...perf, routingMode: 'apps', proxyApps: ['org.telegram.messenger'] },
      'proxy',
    );
    expect(plan.performanceSettings.routingMode).toBe('all');
    expect(plan.allowedApps).toEqual([]);
  });
});

describe('adaptConfigForAndroid', () => {
  const tunConfig = (): XrayConfig =>
    ({
      inbounds: [
        { tag: 'tun-in', port: 0, protocol: 'tun', settings: { mtu: 1400 } },
        {
          tag: 'socks',
          port: 10808,
          listen: '127.0.0.1',
          protocol: 'socks',
          settings: { udp: true },
        },
        {
          tag: 'http',
          port: 10809,
          listen: '127.0.0.1',
          protocol: 'http',
          settings: {},
        },
      ],
      outbounds: [{ tag: 'proxy', protocol: 'vless' }],
    }) as XrayConfig;

  it('leaves the tunnel as the only way into a VPN session', () => {
    // Apps the VPN leaves out share loopback and would reach the server
    // through a local proxy, learning its address (issue #93).
    const adapted = adaptConfigForAndroid(tunConfig(), 'tun');
    expect(adapted.inbounds?.map((inbound) => inbound.tag)).toEqual(['tun-in']);
  });

  it('keeps the local proxy of a proxy-only session', () => {
    const config = tunConfig();
    config.inbounds = config.inbounds?.slice(1);
    const adapted = adaptConfigForAndroid(config, 'proxy');
    expect(adapted.inbounds).toEqual(config.inbounds);
  });

  it('strips the gRPC API and the TUN settings the VpnService owns', () => {
    const config: XrayConfig = {
      api: { tag: 'api', listen: '127.0.0.1:10813', services: [] },
      inbounds: [
        {
          tag: 'tun-in',
          port: 0,
          protocol: 'tun',
          settings: {
            name: 'ultima0',
            mtu: 1400,
            gateway: ['172.19.0.1/30'],
            dns: ['1.1.1.1'],
            autoOutboundsInterface: 'auto',
            autoSystemRoutingTable: ['0.0.0.0/0'],
          },
        },
        { tag: 'socks', port: 10808, protocol: 'socks', settings: {} },
      ],
      outbounds: [{ tag: 'proxy', protocol: 'vless' }],
    } as XrayConfig;
    const adapted = adaptConfigForAndroid(config, 'tun');
    expect(adapted.api).toBeUndefined();
    // The name keeps Xray from enumerating interfaces over netlink.
    expect(adapted.inbounds?.[0].settings).toEqual({
      name: 'ultima0',
      mtu: 1400,
    });
    // The input stays untouched.
    expect(config.api).toBeDefined();
    expect(config.inbounds).toHaveLength(2);
  });
});

describe('buildVpnOptions', () => {
  it('keeps IPv6 off the tunnel with the default IPv4-only DNS', () => {
    // Telegram's IPv6 connects would otherwise hang on a server without IPv6.
    const options = buildVpnOptions(perf, planAndroidRouting(perf, 'tun'));
    expect(options.ipv6Address).toBeNull();
    expect(options.dnsServers).toEqual(['1.1.1.1', '1.0.0.1']);
  });

  it('routes IPv6 through the tunnel when DNS hands out AAAA', () => {
    for (const strategy of ['UseIP', 'UseIPv6', 'UseSystem'] as const) {
      const settings = { ...perf, tunDnsQueryStrategy: strategy };
      const options = buildVpnOptions(
        settings,
        planAndroidRouting(settings, 'tun'),
      );
      expect(options.ipv6Address).toBe(TUN_IPV6_ADDRESS);
    }
  });
});
