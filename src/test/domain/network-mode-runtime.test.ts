import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERFORMANCE_SETTINGS } from '@/shared/types';
import { resolveTunAutoRoute } from '@/shared/tunRouting';
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

  it('tun auto-route on Windows pins host routes and dials resolved IP', async () => {
    const server = makeServer({ address: 'oauth.example.com' });
    const prepareRoutingPlan = vi.fn(async () => PLAN);
    const pinProxyHostRoutes = vi.fn();
    const perf = {
      ...DEFAULT_PERFORMANCE_SETTINGS,
      windowsTunRouting: 'xray' as const,
      tunBlockDnsLeaks: true,
    };
    const runtime = createTunNetworkRuntime(
      {
        prepareRoutingPlan,
        pinProxyHostRoutes,
        enable: vi.fn(),
        disable: vi.fn(),
      },
      { getPerformanceSettings: () => perf },
    );

    const prepared = await runtime.prepare({
      server,
      mode: 'tun',
      ports: PORTS,
    });

    expect(resolveTunAutoRoute(process.platform, perf)).toBe(true);
    if (process.platform === 'win32') {
      expect(prepareRoutingPlan).toHaveBeenCalledWith(server, {
        awaitStableDefaultRoute: false,
      });
      expect(pinProxyHostRoutes).toHaveBeenCalled();
      expect(prepared.server.address).toBe('203.0.113.1');
      expect(prepared.xrayOptions).toEqual(
        expect.objectContaining({
          sendThrough: undefined,
          tunAutoRoute: true,
          blockDnsLeaks: true,
        }),
      );
    } else {
      expect(prepareRoutingPlan).not.toHaveBeenCalled();
      expect(pinProxyHostRoutes).not.toHaveBeenCalled();
      expect(prepared.server).toBe(server);
      // WFP filters are Windows-only even though Xray auto-routes here.
      expect(prepared.xrayOptions).toEqual(
        expect.objectContaining({
          tunAutoRoute: true,
          sendThrough: undefined,
          blockDnsLeaks: false,
        }),
      );
    }
  });
});
