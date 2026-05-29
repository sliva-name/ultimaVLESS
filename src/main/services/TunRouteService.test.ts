import { describe, expect, it, vi } from 'vitest';
import { TunRouteService, type TunRoutingPlan } from './TunRouteService';
import { makeServer } from '@/test/factories';

vi.mock('./ConfigService', () => ({
  configService: {
    getServers: vi.fn(() => []),
  },
}));

vi.mock('./tunRoute/platformAdapter', () => ({
  createPlatformTunAdapter: () => ({
    isSupported: () => true,
    getUnsupportedReason: () => null,
    getRouteMode: () => 'windows-static-routes',
    getDegradedReason: () => null,
  }),
}));

vi.mock('./tunRoute/powerShellRunner', () => ({
  runPowerShell: vi.fn(async (script: string) => {
    if (script.includes('waitForTunInterface')) return '7';
    if (script.includes('CREATED_IPV6')) return 'CREATED\nCREATED_IPV6';
    if (script.includes('CREATED')) return 'CREATED';
    return '';
  }),
}));

describe('TunRouteService Windows routing', () => {
  it('adds proxy host routes and default routes through the TUN interface', async () => {
    const service = new TunRouteService('win32');
    const calls: Array<{ destination: string; gateway: string }> = [];
    vi.spyOn(service as any, 'waitForTunInterface').mockResolvedValue(7);
    vi.spyOn(service as any, 'ensureTunAddress').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'cleanupCurrentProxyHostRoutes').mockResolvedValue(
      undefined,
    );
    vi.spyOn(service as any, 'addRoute').mockImplementation(
      async (destination: string, _mask: string, gateway: string) => {
        calls.push({ destination, gateway });
        return true;
      },
    );
    const addDefault = vi
      .spyOn(service as any, 'addDefaultRouteViaTun')
      .mockResolvedValue(undefined);
    const plan: TunRoutingPlan = {
      defaultRoute: {
        interfaceIndex: 12,
        gateway: '192.168.1.1',
        interfaceName: 'Ethernet',
        localAddress: '192.168.1.10',
      },
      proxyIps: ['203.0.113.10'],
    };

    await service.enable(makeServer(), plan);

    expect(calls).toEqual([
      { destination: '203.0.113.10', gateway: '192.168.1.1' },
    ]);
    expect(addDefault).toHaveBeenCalledWith(7);
  });
});
