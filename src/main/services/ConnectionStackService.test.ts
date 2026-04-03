import { describe, expect, it, vi } from 'vitest';
vi.mock('./SystemProxyService', () => ({
  SystemProxyService: class SystemProxyService {},
  systemProxyService: {},
}));
vi.mock('./TunRouteService', () => ({
  TunRouteService: class TunRouteService {},
  tunRouteService: {},
}));
vi.mock('./XrayService', () => ({
  XrayService: class XrayService {},
  xrayService: {},
}));

import { ConnectionStackService } from './ConnectionStackService';
import { makeServer } from '../../test/factories';

describe('ConnectionStackService', () => {
  function createDeferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  it('serializes transition and reset operations through one queue', async () => {
    const calls: string[] = [];
    const firstDisable = createDeferred();
    const service = new ConnectionStackService(
      {
        disable: vi.fn(async () => {
          calls.push('proxy-disable');
          if (calls.filter((call) => call === 'proxy-disable').length === 1) {
            await firstDisable.promise;
          }
        }),
        enable: vi.fn(async () => {
          calls.push('proxy-enable');
        }),
      } as any,
      {
        disable: vi.fn(async () => {
          calls.push('route-disable');
        }),
        prepareRoutingPlan: vi.fn(),
        enable: vi.fn(),
      } as any,
      {
        stop: vi.fn(() => {
          calls.push('xray-stop');
        }),
        start: vi.fn(async () => {
          calls.push('xray-start');
        }),
      } as any
    );

    const transition = service.transitionTo(makeServer({ uuid: 'server-1' }), 'proxy', { http: 10809, socks: 10808 }, {
      stopXray: true,
    });
    const reset = service.resetNetworkingStack({ stopXray: true });

    await Promise.resolve();
    expect(calls).toEqual(['proxy-disable']);

    firstDisable.resolve();
    await Promise.all([transition, reset]);

    expect(calls).toEqual([
      'proxy-disable',
      'route-disable',
      'xray-stop',
      'xray-start',
      'proxy-enable',
      'proxy-disable',
      'route-disable',
      'xray-stop',
    ]);
  });

  it('cleans up through the same reset flow after failures', async () => {
    const calls: string[] = [];
    const service = new ConnectionStackService(
      {
        disable: vi.fn(async () => {
          calls.push('proxy-disable');
        }),
        enable: vi.fn(),
      } as any,
      {
        disable: vi.fn(async () => {
          calls.push('route-disable');
        }),
        prepareRoutingPlan: vi.fn(),
        enable: vi.fn(),
      } as any,
      {
        stop: vi.fn(() => {
          calls.push('xray-stop');
        }),
        start: vi.fn(),
      } as any
    );

    await service.cleanupAfterFailure();

    expect(calls).toEqual(['proxy-disable', 'route-disable', 'xray-stop']);
  });
});
