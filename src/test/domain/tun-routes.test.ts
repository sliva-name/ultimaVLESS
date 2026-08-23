import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERFORMANCE_SETTINGS } from '@/shared/types';
import {
  TunRouteService,
  type TunRoutingPlan,
} from '@/main/services/TunRouteService';
import { configService } from '@/main/services/ConfigService';
import { makeServer } from '@/test/factories';

vi.mock('@/main/services/ConfigService', () => ({
  configService: {
    getPerformanceSettings: vi.fn(() => ({
      windowsTunRouting: 'powershell',
    })),
  },
}));

vi.mock('@/main/infrastructure/persistence/ElectronServerRepository', () => ({
  getServerRepository: () => ({
    list: vi.fn(() => []),
  }),
}));

vi.mock('@/main/services/tunRoute/platformAdapter', () => ({
  createPlatformTunAdapter: () => ({
    isSupported: () => true,
    getUnsupportedReason: () => null,
    getRouteMode: () => 'windows-static-routes',
    getDegradedReason: () => null,
  }),
}));

vi.mock('@/main/services/tunRoute/powerShellRunner', () => ({
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

  beforeEach(() => {
    vi.mocked(configService.getPerformanceSettings).mockReturnValue({
      ...DEFAULT_PERFORMANCE_SETTINGS,
      windowsTunRouting: 'powershell',
    });
  });

  it('applies the full TUN routing setup in a single PowerShell call', async () => {
    const service = new TunRouteService('win32');
    vi.spyOn(service as any, 'waitForTunInterface').mockResolvedValue(7);
    const runPowerShell = vi
      .spyOn(service as any, 'runPowerShell')
      .mockResolvedValue(
        [
          'HOST_CREATED|203.0.113.10/32',
          'DEFAULT4_CREATED',
          'DEFAULT6_CREATED',
        ].join('\n'),
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
    // Existing host routes with a stale NextHop must be removed and recreated.
    expect(script).toContain('$existingHost.NextHop -ne "192.168.1.1"');
  });

  it('records created routes from the script output for teardown', async () => {
    const service = new TunRouteService('win32');
    vi.spyOn(service as any, 'waitForTunInterface').mockResolvedValue(7);
    vi.spyOn(service as any, 'runPowerShell').mockResolvedValue(
      [
        'HOST_CREATED|203.0.113.10/32',
        'DEFAULT4_CREATED',
        'DEFAULT6_CREATED',
      ].join('\n'),
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

  it('fails enable and rolls back when a proxy host route cannot be added', async () => {
    const service = new TunRouteService('win32');
    vi.spyOn(service as any, 'waitForTunInterface').mockResolvedValue(7);
    vi.spyOn(service as any, 'runPowerShell').mockResolvedValue(
      [
        'HOST_FAIL|203.0.113.10/32|Access denied',
        'DEFAULT4_CREATED',
        'DEFAULT6_CREATED',
      ].join('\n'),
    );
    const disableSpy = vi
      .spyOn(service, 'disable')
      .mockResolvedValue(undefined);

    await expect(service.enable(makeServer(), plan)).rejects.toThrow(
      /host route/i,
    );
    // Rollback must also sweep known-server /32 routes that the failed enable
    // may have created before recordEnabledRoutes ran.
    expect(disableSpy).toHaveBeenCalledWith({
      includeKnownServerHostRoutes: true,
    });
  });

  it('sweeps known-server host routes when enable fails before bookkeeping', async () => {
    const service = new TunRouteService('win32');
    vi.spyOn(service as any, 'waitForTunInterface').mockResolvedValue(7);
    vi.spyOn(service as any, 'runPowerShell').mockRejectedValue(
      new Error('DEFAULT_FAIL|route add failed'),
    );
    const cleanupSpy = vi
      .spyOn(service as any, 'cleanupStaleTunRoutes')
      .mockResolvedValue(undefined);

    await expect(service.enable(makeServer(), plan)).rejects.toThrow(
      'DEFAULT_FAIL|route add failed',
    );
    expect(cleanupSpy).toHaveBeenCalledWith({
      includeKnownServerHostRoutes: true,
    });
  });

  it('recoverOrphanedRoutes cleans up default and known-server host routes', async () => {
    const service = new TunRouteService('win32');
    const cleanupSpy = vi
      .spyOn(service as any, 'cleanupStaleTunRoutes')
      .mockResolvedValue(undefined);

    await service.recoverOrphanedRoutes();

    expect(cleanupSpy).toHaveBeenCalledWith({
      includeKnownServerHostRoutes: true,
    });
  });

  it('recoverOrphanedRoutes still cleans host routes in Xray auto-route mode', async () => {
    vi.mocked(configService.getPerformanceSettings).mockReturnValue({
      ...DEFAULT_PERFORMANCE_SETTINGS,
      windowsTunRouting: 'xray',
    });
    const service = new TunRouteService('win32');
    const cleanupSpy = vi
      .spyOn(service as any, 'cleanupStaleTunRoutes')
      .mockResolvedValue(undefined);

    await service.recoverOrphanedRoutes();

    expect(cleanupSpy).toHaveBeenCalledWith({
      includeKnownServerHostRoutes: true,
    });
  });

  it('reapplyRoutesAfterResume is a no-op when TUN routing is inactive', async () => {
    const service = new TunRouteService('win32');
    const runPowerShell = vi.spyOn(service as any, 'runPowerShell');

    await service.reapplyRoutesAfterResume();

    expect(runPowerShell).not.toHaveBeenCalled();
  });

  it('reapplyRoutesAfterResume re-pins host routes via the new gateway', async () => {
    const service = new TunRouteService('win32');
    vi.spyOn(service as any, 'waitForTunInterface').mockResolvedValue(7);
    const runPowerShell = vi
      .spyOn(service as any, 'runPowerShell')
      .mockResolvedValue(
        [
          'HOST_CREATED|203.0.113.10/32',
          'DEFAULT4_CREATED',
          'DEFAULT6_CREATED',
        ].join('\n'),
      );
    await service.enable(makeServer(), plan);
    runPowerShell.mockClear();

    vi.spyOn(service as any, 'waitForDefaultRoute').mockResolvedValue({
      interfaceIndex: 21,
      gateway: '10.0.0.1',
      interfaceName: 'Wi-Fi',
      localAddress: '10.0.0.5',
    });
    runPowerShell.mockResolvedValue('HOST_CREATED|203.0.113.10/32');

    await service.reapplyRoutesAfterResume();

    expect(runPowerShell).toHaveBeenCalledTimes(1);
    const script = runPowerShell.mock.calls[0][0] as string;
    expect(script).toContain("'203.0.113.10/32'");
    expect(script).toContain('10.0.0.1');
    expect(script).toContain('-InterfaceIndex 21');
    const hostRoute = (service as any).addedRoutes.find(
      (route: { prefix?: string }) => route.prefix === '203.0.113.10/32',
    );
    expect(hostRoute.interfaceIndex).toBe(21);
  });

  it('reapplyRoutesAfterResume skips PowerShell when the gateway is unchanged', async () => {
    const service = new TunRouteService('win32');
    vi.spyOn(service as any, 'waitForTunInterface').mockResolvedValue(7);
    const runPowerShell = vi
      .spyOn(service as any, 'runPowerShell')
      .mockResolvedValue(
        [
          'HOST_CREATED|203.0.113.10/32',
          'DEFAULT4_CREATED',
          'DEFAULT6_CREATED',
        ].join('\n'),
      );
    await service.enable(makeServer(), plan);
    runPowerShell.mockClear();

    vi.spyOn(service as any, 'waitForDefaultRoute').mockResolvedValue(
      plan.defaultRoute,
    );

    await service.reapplyRoutesAfterResume();

    expect(runPowerShell).not.toHaveBeenCalled();
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

  it('auto-route enable does not discover default route or DNS without a plan', async () => {
    vi.mocked(configService.getPerformanceSettings).mockReturnValue({
      ...DEFAULT_PERFORMANCE_SETTINGS,
      windowsTunRouting: 'xray',
    });

    const service = new TunRouteService('win32');
    const prepare = vi.spyOn(service, 'prepareRoutingPlan');
    const runPowerShell = vi.spyOn(service as any, 'runPowerShell');

    await service.enable(makeServer());

    expect(prepare).not.toHaveBeenCalled();
    expect(runPowerShell).not.toHaveBeenCalled();
  });
});
