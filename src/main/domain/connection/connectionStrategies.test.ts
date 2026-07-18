import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERFORMANCE_SETTINGS } from '@/shared/types';
import { resolveTunAutoRoute } from '@/shared/tunRouting';
import { makeServer } from '@/test/factories';
import {
  createConnectionStrategies,
  createNetworkTeardown,
} from './connectionStrategies';

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

  it('tun strategy prepares routing before starting Xray with loop prevention', async () => {
    const server = makeServer();
    const coreStart = vi.fn();
    const routeEnable = vi.fn();
    const perf = { ...DEFAULT_PERFORMANCE_SETTINGS, windowsTunRouting: 'xray' as const };
    const strategies = createConnectionStrategies({
      coreService: { start: coreStart } as any,
      proxyService: {} as any,
      routeService: {
        prepareRoutingPlan: vi.fn(async () => ({
          defaultRoute: { localAddress: '192.168.1.10' },
          proxyIps: ['203.0.113.1'],
        })),
        enable: routeEnable,
      } as any,
      configService: {
        getPerformanceSettings: vi.fn(() => perf),
      },
    });

    await strategies.tun.apply(server, { http: 10809, socks: 10808 });

    const tunAutoRoute = resolveTunAutoRoute(process.platform, perf);
    expect(coreStart).toHaveBeenCalledWith(
      server,
      'tun',
      expect.objectContaining({
        sendThrough: tunAutoRoute ? undefined : '192.168.1.10',
        tunAutoRoute,
      }),
    );
    expect(routeEnable).toHaveBeenCalled();
  });

  it('tun powershell fallback still passes sendThrough for loop prevention', async () => {
    const server = makeServer();
    const coreStart = vi.fn();
    const perf = {
      ...DEFAULT_PERFORMANCE_SETTINGS,
      windowsTunRouting: 'powershell' as const,
    };
    const strategies = createConnectionStrategies({
      coreService: { start: coreStart } as any,
      proxyService: {} as any,
      routeService: {
        prepareRoutingPlan: vi.fn(async () => ({
          defaultRoute: { localAddress: '192.168.1.10' },
          proxyIps: ['203.0.113.1'],
        })),
        enable: vi.fn(),
      } as any,
      configService: {
        getPerformanceSettings: vi.fn(() => perf),
      },
    });

    await strategies.tun.apply(server, { http: 10809, socks: 10808 });

    expect(coreStart).toHaveBeenCalledWith(
      server,
      'tun',
      expect.objectContaining({
        sendThrough:
          process.platform === 'win32' ? '192.168.1.10' : undefined,
        tunAutoRoute: resolveTunAutoRoute(process.platform, perf),
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

    expect(calls).toEqual(['proxy', 'routes', 'xray']);
  });
});
