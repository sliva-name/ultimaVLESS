import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERFORMANCE_SETTINGS } from '@/shared/types';
import { TunRouteService, type TunRoutingPlan } from './TunRouteService';
import { configService } from './ConfigService';
import { makeServer } from '@/test/factories';

vi.mock('./ConfigService', () => ({
  configService: {
    getServers: vi.fn(() => []),
    getPerformanceSettings: vi.fn(() => ({
      windowsTunRouting: 'powershell',
    })),
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
  const plan: TunRoutingPlan = {
    defaultRoute: {
      interfaceIndex: 12,
      gateway: '192.168.1.1',
      interfaceName: 'Ethernet',
      localAddress: '192.168.1.10',
    },
    proxyIps: ['203.0.113.10'],
  };

  it('applies the full TUN routing setup in a single PowerShell call', async () => {
    const service = new TunRouteService('win32');
    vi.spyOn(service as any, 'waitForTunInterface').mockResolvedValue(7);
    const runPowerShell = vi
      .spyOn(service as any, 'runPowerShell')
      .mockResolvedValue(
        ['HOST_CREATED|203.0.113.10/32', 'DEFAULT4_CREATED', 'DEFAULT6_CREATED'].join(
          '\n',
        ),
      );

    await service.enable(makeServer(), plan);

    expect(runPowerShell).toHaveBeenCalledTimes(1);
    const script = runPowerShell.mock.calls[0][0] as string;
    // Proxy server IP pinned to the physical gateway via the default-route interface.
    expect(script).toContain("'203.0.113.10/32'");
    expect(script).toContain('192.168.1.1');
    expect(script).toContain('-InterfaceIndex 12');
    // Default route via the TUN interface index.
    expect(script).toContain('$tunIdx = 7');
    expect(script).toContain('0.0.0.0/0');
    expect(script).toContain('::/0');
  });

  it('records created routes from the script output for teardown', async () => {
    const service = new TunRouteService('win32');
    vi.spyOn(service as any, 'waitForTunInterface').mockResolvedValue(7);
    vi.spyOn(service as any, 'runPowerShell').mockResolvedValue(
      ['HOST_CREATED|203.0.113.10/32', 'DEFAULT4_CREATED', 'DEFAULT6_CREATED'].join(
        '\n',
      ),
    );

    await service.enable(makeServer(), plan);

    expect((service as any).addedRoutes).toEqual([
      {
        destination: '203.0.113.10',
        mask: '255.255.255.255',
        interfaceIndex: 12,
        prefix: '203.0.113.10/32',
      },
      { destination: '0.0.0.0', mask: '0.0.0.0', interfaceIndex: 7 },
      { destination: '::', mask: '::', interfaceIndex: 7, prefix: '::/0' },
    ]);
  });

  it('skips PowerShell when Windows routing is delegated to Xray', async () => {
    vi.mocked(configService.getPerformanceSettings).mockReturnValue({
      ...DEFAULT_PERFORMANCE_SETTINGS,
      windowsTunRouting: 'xray',
    });

    const service = new TunRouteService('win32');
    const runPowerShell = vi.spyOn(service as any, 'runPowerShell');

    await service.enable(makeServer(), plan);

    expect(runPowerShell).not.toHaveBeenCalled();
  });
});
