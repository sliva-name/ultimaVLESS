import { describe, expect, it, vi } from 'vitest';
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
    });

    await strategies.proxy.apply(makeServer(), { http: 10809, socks: 10808 });

    expect(calls).toEqual(['xray-start', 'proxy-enable']);
  });

  it('tun strategy prepares routing before starting Xray with loop prevention', async () => {
    const server = makeServer();
    const coreStart = vi.fn();
    const routeEnable = vi.fn();
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
    });

    await strategies.tun.apply(server, { http: 10809, socks: 10808 });

    expect(coreStart).toHaveBeenCalledWith(
      server,
      'tun',
      expect.objectContaining({
        sendThrough: '192.168.1.10',
        tunAutoRoute: process.platform !== 'win32',
      }),
    );
    expect(routeEnable).toHaveBeenCalled();
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
