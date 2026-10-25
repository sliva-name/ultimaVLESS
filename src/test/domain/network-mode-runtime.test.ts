import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERFORMANCE_SETTINGS } from '@/shared/types';
import { APP_CONSTANTS } from '@/shared/constants';
import { makeServer } from '@/test/factories';
import {
  createProxyNetworkRuntime,
  createTunNetworkRuntime,
} from '@/main/domain/connection/NetworkModeRuntime';

const PORTS = {
  socks: APP_CONSTANTS.PORTS.SOCKS,
  http: APP_CONSTANTS.PORTS.HTTP,
  api: APP_CONSTANTS.PORTS.API,
};

const PLAN = {
  defaultRoute: {
    localAddress: '192.168.1.10',
    interfaceIndex: 12,
    gateway: '192.168.1.1',
    interfaceName: 'Ethernet',
  },
  proxyIps: ['203.0.113.1'],
};

describe('network mode runtime', () => {
  it('proxy mode points the system proxy at the spec ports', async () => {
    const enable = vi.fn(async () => undefined);
    const runtime = createProxyNetworkRuntime({ enable, disable: vi.fn() });
    const server = makeServer();

    const prepared = await runtime.prepare({
      server,
      mode: 'proxy',
      ports: PORTS,
    });
    await runtime.activate(prepared);

    expect(prepared.server).toBe(server);
    expect(enable).toHaveBeenCalledWith(PORTS.http, PORTS.socks);
  });

  it('Windows TUN dials the resolved server IP through the default-route adapter', async () => {
    const server = makeServer({ address: 'oauth.example.com', sni: '' });
    const prepareRoutingPlan = vi.fn(async () => ({
      ...PLAN,
      outboundInterface: 'Ethernet',
    }));
    const runtime = createTunNetworkRuntime(
      { prepareRoutingPlan },
      {
        getPerformanceSettings: () => ({
          ...DEFAULT_PERFORMANCE_SETTINGS,
          tunBlockDnsLeaks: true,
        }),
      },
      'win32',
    );

    const prepared = await runtime.prepare({
      server,
      mode: 'tun',
      ports: PORTS,
    });

    expect(prepareRoutingPlan).toHaveBeenCalledWith(server);
    expect(prepared.server.address).toBe('203.0.113.1');
    // The domain stays the TLS server name once the address is an IP.
    expect(prepared.server.sni).toBe('oauth.example.com');
    expect(prepared.xrayOptions).toEqual({
      outboundInterface: 'Ethernet',
      blockDnsLeaks: true,
      tunIpv6: undefined,
      tunSplitDefaultRoute: false,
    });
  });

  it('Linux TUN leaves the server and the routes to Xray', async () => {
    const server = makeServer({ address: 'oauth.example.com' });
    const prepareRoutingPlan = vi.fn();
    const runtime = createTunNetworkRuntime(
      { prepareRoutingPlan },
      {
        getPerformanceSettings: () => ({
          ...DEFAULT_PERFORMANCE_SETTINGS,
          // WFP filters exist on Windows only.
          tunBlockDnsLeaks: true,
        }),
      },
      'linux',
    );

    const prepared = await runtime.prepare({
      server,
      mode: 'tun',
      ports: PORTS,
    });

    expect(prepareRoutingPlan).not.toHaveBeenCalled();
    expect(prepared.server).toBe(server);
    expect(prepared.xrayOptions).toEqual(
      expect.objectContaining({
        outboundInterface: undefined,
        blockDnsLeaks: false,
        tunSplitDefaultRoute: true,
      }),
    );
  });
});
