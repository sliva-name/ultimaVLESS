import { afterEach, describe, expect, it, vi } from 'vitest';

const configServiceMock = vi.hoisted(() => ({
  getServers: vi.fn(() => []),
}));

vi.mock('./ConfigService', () => ({
  configService: configServiceMock,
}));

describe('TunRouteService support policy', () => {
  async function loadService() {
    vi.resetModules();
    const mod = await import('./TunRouteService');
    return mod.TunRouteService;
  }

  afterEach(() => {
    vi.resetModules();
    configServiceMock.getServers.mockReset();
    configServiceMock.getServers.mockReturnValue([]);
  });

  it.each([
    {
      platform: 'win32' as const,
      supported: true,
      reason: null,
      routeMode: 'windows-static-routes',
      degradedReason: null,
    },
    {
      platform: 'linux' as const,
      supported: true,
      reason: null,
      routeMode: 'linux-xray-auto-route',
      degradedReason:
        'Linux TUN routing currently relies on Xray auto-route behavior rather than explicit OS-level route teardown.',
    },
    {
      platform: 'darwin' as const,
      supported: false,
      reason:
        'TUN mode is currently supported only on Windows and Linux by the bundled Xray core.',
      routeMode: null,
      degradedReason: null,
    },
    {
      platform: 'freebsd' as const,
      supported: false,
      reason: 'TUN mode is not supported on this operating system.',
      routeMode: null,
      degradedReason: null,
    },
  ])(
    'reports support policy for $platform',
    async ({ platform, supported, reason, routeMode, degradedReason }) => {
      const TunRouteService = await loadService();
      const service = new TunRouteService(platform);

      expect(service.isSupported()).toBe(supported);
      expect(service.getUnsupportedReason()).toBe(reason);
      expect(service.getRouteMode()).toBe(routeMode);
      expect(service.getDegradedReason()).toBe(degradedReason);
    },
  );

  it('rejects prepareRoutingPlan when platform is unsupported', async () => {
    const TunRouteService = await loadService();
    const service = new TunRouteService('darwin');

    await expect(
      service.prepareRoutingPlan({
        uuid: 'server-1',
        name: 'Server 1',
        address: 'example.com',
        port: 443,
      }),
    ).rejects.toThrow(
      'TUN mode is currently supported only on Windows and Linux by the bundled Xray core.',
    );
  });

  it('does not track routes that already existed before enable', async () => {
    const TunRouteService = await loadService();
    const service = new TunRouteService('win32');
    const runPowerShell = vi.spyOn(service as any, 'runPowerShell');
    vi.spyOn(service as any, 'prepareRoutingPlan').mockResolvedValue({
      defaultRoute: {
        gateway: '192.168.1.1',
        interfaceIndex: 7,
        interfaceName: 'Ethernet',
        localAddress: '192.168.1.10',
      },
      proxyIps: ['1.2.3.4'],
    });
    vi.spyOn(service as any, 'waitForTunInterface').mockResolvedValue(42);
    vi.spyOn(service as any, 'ensureTunAddress').mockResolvedValue(undefined);

    runPowerShell
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('');

    await service.enable({
      uuid: 'server-1',
      name: 'Server 1',
      address: '1.2.3.4',
      port: 443,
    });

    const callsBeforeDisable = runPowerShell.mock.calls.length;
    await service.disable();

    const deleteCalls = runPowerShell.mock.calls
      .slice(callsBeforeDisable)
      .filter(([script]) => String(script).includes('Remove-NetRoute'));
    expect(deleteCalls).toHaveLength(1);
    expect(String(deleteCalls[0][0])).toContain(
      'Get-NetRoute -DestinationPrefix "0.0.0.0/0"',
    );
  });

  it('includes resolved domain IPs when cleaning up stale routes', async () => {
    configServiceMock.getServers.mockReturnValue([
      { uuid: 'server-1', name: 'Server 1', address: 'example.com', port: 443 },
    ]);

    const TunRouteService = await loadService();
    const service = new TunRouteService('win32');
    vi.spyOn(service as any, 'resolveProxyAddresses').mockResolvedValue([
      '203.0.113.10',
    ]);
    vi.spyOn(service as any, 'getTunInterfaceIndex').mockResolvedValue(null);
    const deleteHostRoutes = vi
      .spyOn(service as any, 'deleteHostRoutesByPrefixesAndMetric')
      .mockResolvedValue(1);
    vi.spyOn(
      service as any,
      'deleteTunDefaultRoutesByNextHop',
    ).mockResolvedValue(undefined);

    await service.disable();

    expect(deleteHostRoutes).toHaveBeenCalledWith(['203.0.113.10/32'], 1);
  });
});
