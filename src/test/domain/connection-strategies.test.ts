import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERFORMANCE_SETTINGS } from '@/shared/types';
import { resolveTunAutoRoute } from '@/shared/tunRouting';
import { makeServer } from '@/test/factories';
import {
  createConnectionStrategies,
  createNetworkTeardown,
} from '@/main/domain/connection/connectionStrategies';

describe('connection strategies', () => {
  it('proxy strategy starts Xray before enabling system proxy', async () => {
    const calls: string[] = [];
    const strategies = createConnectionStrategies({
      coreService: {
        start: vi.fn(async () => calls.push('xray-start')),
      } as any,
      proxyService: {
        enable: vi.fn(async () => calls.push('proxy-enable')),
      } as any,
      routeService: {} as any,
      configService: {
        getPerformanceSettings: vi.fn(() => DEFAULT_PERFORMANCE_SETTINGS),
      },
    });

    await strategies.proxy.apply(makeServer(), { http: 10809, socks: 10808 });

    expect(calls).toEqual(['xray-start', 'proxy-enable']);
  });

  it('tun auto-route on Windows pins host routes and dials resolved IP', async () => {
    const server = makeServer({ address: 'oauth.example.com' });
    const coreStart = vi.fn();
    const prepareRoutingPlan = vi.fn(async () => ({
      defaultRoute: {
        localAddress: '192.168.1.10',
        interfaceIndex: 12,
        gateway: '192.168.1.1',
        interfaceName: 'Ethernet',
      },
      proxyIps: ['203.0.113.1'],
    }));
    const pinProxyHostRoutes = vi.fn();
    const routeEnable = vi.fn();
    const perf = {
      ...DEFAULT_PERFORMANCE_SETTINGS,
      windowsTunRouting: 'xray' as const,
    };
    const strategies = createConnectionStrategies({
      coreService: { start: coreStart } as any,
      proxyService: {} as any,
      routeService: {
        prepareRoutingPlan,
        pinProxyHostRoutes,
        enable: routeEnable,
      } as any,
      configService: {
        getPerformanceSettings: vi.fn(() => perf),
      },
    });

    await strategies.tun.apply(server, { http: 10809, socks: 10808 });

    expect(resolveTunAutoRoute(process.platform, perf)).toBe(true);
    if (process.platform === 'win32') {
      expect(prepareRoutingPlan).toHaveBeenCalledWith(server, {
        awaitStableDefaultRoute: false,
      });
      expect(pinProxyHostRoutes).toHaveBeenCalled();
      expect(coreStart).toHaveBeenCalledWith(
        expect.objectContaining({ address: '203.0.113.1' }),
        'tun',
        expect.objectContaining({
          sendThrough: undefined,
          tunAutoRoute: true,
        }),
      );
    } else {
      expect(prepareRoutingPlan).not.toHaveBeenCalled();
      expect(pinProxyHostRoutes).not.toHaveBeenCalled();
      expect(coreStart).toHaveBeenCalledWith(
        server,
        'tun',
        expect.objectContaining({ tunAutoRoute: true, sendThrough: undefined }),
      );
    }
    expect(routeEnable).toHaveBeenCalled();
  });

  it('tun powershell fallback still passes sendThrough for loop prevention', async () => {
    const server = makeServer();
    const coreStart = vi.fn();
    const prepareRoutingPlan = vi.fn(async () => ({
      defaultRoute: {
        localAddress: '192.168.1.10',
        interfaceIndex: 12,
        gateway: '192.168.1.1',
        interfaceName: 'Ethernet',
      },
      proxyIps: ['203.0.113.1'],
    }));
    const pinProxyHostRoutes = vi.fn();
    const perf = {
      ...DEFAULT_PERFORMANCE_SETTINGS,
      windowsTunRouting: 'powershell' as const,
    };
    const strategies = createConnectionStrategies({
      coreService: { start: coreStart } as any,
      proxyService: {} as any,
      routeService: {
        prepareRoutingPlan,
        pinProxyHostRoutes,
        enable: vi.fn(),
      } as any,
      configService: {
        getPerformanceSettings: vi.fn(() => perf),
      },
    });

    await strategies.tun.apply(server, { http: 10809, socks: 10808 });

    const tunAutoRoute = resolveTunAutoRoute(process.platform, perf);
    if (tunAutoRoute) {
      // Non-Windows always auto-routes; PowerShell plan is Windows-only.
      expect(coreStart).toHaveBeenCalledWith(
        expect.anything(),
        'tun',
        expect.objectContaining({
          sendThrough: undefined,
          tunAutoRoute: true,
        }),
      );
      return;
    }

    expect(prepareRoutingPlan).toHaveBeenCalledWith(server, {
      awaitStableDefaultRoute: false,
    });
    expect(pinProxyHostRoutes).toHaveBeenCalled();
    expect(coreStart).toHaveBeenCalledWith(
      expect.objectContaining({ address: '203.0.113.1' }),
      'tun',
      expect.objectContaining({
        sendThrough: '192.168.1.10',
        tunAutoRoute: false,
      }),
    );
  });

  it('network teardown disables OS effects before stopping Xray', async () => {
    const calls: string[] = [];
    const teardown = createNetworkTeardown({
      proxyService: { disable: vi.fn(async () => calls.push('proxy')) } as any,
      routeService: { disable: vi.fn(async () => calls.push('routes')) } as any,
      coreService: { stop: vi.fn(() => calls.push('xray')) } as any,
    });

    await teardown.reset({ stopXray: true });

    expect(calls.sort()).toEqual(['proxy', 'routes', 'xray'].sort());
    expect(calls[calls.length - 1]).toBe('xray');
  });

  it('network teardown can keep system proxy during a server switch', async () => {
    const calls: string[] = [];
    const teardown = createNetworkTeardown({
      proxyService: { disable: vi.fn(async () => calls.push('proxy')) } as any,
      routeService: { disable: vi.fn(async () => calls.push('routes')) } as any,
      coreService: { stop: vi.fn(() => calls.push('xray')) } as any,
    });

    await teardown.reset({ stopXray: true, keepSystemProxy: true });

    expect(calls).toEqual(['routes', 'xray']);
  });
});
