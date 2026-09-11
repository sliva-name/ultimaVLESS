import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERFORMANCE_SETTINGS } from '@/shared/types';
import {
  TunRouteService,
  type TunRoutingPlan,
} from '@/main/services/TunRouteService';
import { createMemoryTunRouteStateStore } from '@/main/services/tunRoute/routeStateStore';
import type { WindowsNativeRouting } from '@/main/services/tunRoute/windowsNativeRouting';
import { configService } from '@/main/services/ConfigService';
import { makeServer } from '@/test/factories';

vi.mock('@/main/services/ConfigService', () => ({
  configService: {
    getPerformanceSettings: vi.fn(() => ({
      windowsTunRouting: 'powershell',
    })),
  },
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
  runPowerShell: vi.fn(async () => ''),
}));

const ENABLE_OUTPUT = [
  'HOST_CREATED|203.0.113.10/32',
  'DEFAULT4_CREATED',
  'DEFAULT6_CREATED',
].join('\n');

function createService(
  options: { elevated?: boolean; native?: WindowsNativeRouting | null } = {},
) {
  const stateStore = createMemoryTunRouteStateStore();
  const service = new TunRouteService('win32', {
    stateStore,
    isElevated: async () => options.elevated ?? true,
    // These specs exercise the PowerShell path unless a native fake is given.
    nativeRouting: options.native ?? null,
  });
  return { service, stateStore };
}

function createNativeFake(
  overrides: Partial<WindowsNativeRouting> = {},
): WindowsNativeRouting & {
  discoverDefaultRoute: ReturnType<typeof vi.fn>;
  addHostRoutes: ReturnType<typeof vi.fn>;
  removeHostRoutes: ReturnType<typeof vi.fn>;
} {
  return {
    discoverDefaultRoute: vi.fn(async () => null),
    addHostRoutes: vi.fn(async ({ prefixes }: { prefixes: string[] }) => ({
      created: prefixes,
      failed: [],
    })),
    removeHostRoutes: vi.fn(async (prefixes: string[]) => ({
      removed: prefixes.length,
      remaining: [],
    })),
    ...overrides,
  } as WindowsNativeRouting & {
    discoverDefaultRoute: ReturnType<typeof vi.fn>;
    addHostRoutes: ReturnType<typeof vi.fn>;
    removeHostRoutes: ReturnType<typeof vi.fn>;
  };
}

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
    const { service } = createService();
    vi.spyOn(service as any, 'waitForTunInterface').mockResolvedValue(7);
    const runPowerShell = vi
      .spyOn(service as any, 'runPowerShell')
      .mockResolvedValue(ENABLE_OUTPUT);

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
    // A failed default route is reported as a marker, never as exit 1, so the
    // HOST_CREATED bookkeeping printed before it is not lost.
    expect(script).not.toMatch(/exit 1/);
  });

  it('records created routes from the script output and persists them', async () => {
    const { service, stateStore } = createService();
    vi.spyOn(service as any, 'waitForTunInterface').mockResolvedValue(7);
    vi.spyOn(service as any, 'runPowerShell').mockResolvedValue(ENABLE_OUTPUT);

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
    expect(stateStore.current).toMatchObject({
      version: 1,
      hostPrefixes: ['203.0.113.10/32'],
      defaultRoutes: true,
      tunInterfaceIndex: 7,
    });
  });

  it('pinProxyHostRoutes persists the pinned prefixes for crash recovery', async () => {
    const { service, stateStore } = createService();
    vi.spyOn(service as any, 'runPowerShell').mockResolvedValue(
      'HOST_CREATED|203.0.113.10/32',
    );

    await service.pinProxyHostRoutes(plan);

    expect(stateStore.current).toMatchObject({
      hostPrefixes: ['203.0.113.10/32'],
      defaultRoutes: false,
      tunInterfaceIndex: null,
    });
  });

  it('disable is a no-op when nothing was created', async () => {
    const { service } = createService();
    const runPowerShell = vi.spyOn(service as any, 'runPowerShell');

    await service.disable();

    expect(runPowerShell).not.toHaveBeenCalled();
  });

  it('disable removes every created route in one PowerShell call and clears state', async () => {
    const { service, stateStore } = createService();
    vi.spyOn(service as any, 'waitForTunInterface').mockResolvedValue(7);
    const runPowerShell = vi
      .spyOn(service as any, 'runPowerShell')
      .mockResolvedValue(ENABLE_OUTPUT);
    await service.enable(makeServer(), plan);
    runPowerShell.mockClear();
    runPowerShell.mockResolvedValue('REMOVED|1|2');

    await service.disable();

    expect(runPowerShell).toHaveBeenCalledTimes(1);
    const script = runPowerShell.mock.calls[0][0] as string;
    expect(script).toContain("'203.0.113.10/32'");
    expect(script).toContain('$tunIdx = 7');
    expect(script).toContain('0.0.0.0/0');
    expect(script).toContain('::/0');
    expect((service as any).addedRoutes).toEqual([]);
    expect(stateStore.current).toBeNull();
  });

  it('keeps the persisted state when the removal fails so a later start retries', async () => {
    const { service, stateStore } = createService();
    vi.spyOn(service as any, 'waitForTunInterface').mockResolvedValue(7);
    const runPowerShell = vi
      .spyOn(service as any, 'runPowerShell')
      .mockResolvedValue(ENABLE_OUTPUT);
    await service.enable(makeServer(), plan);
    runPowerShell.mockRejectedValue(new Error('powershell timed out'));

    await service.disable();

    expect(stateStore.current).not.toBeNull();
  });

  it('fails enable and rolls back the planned prefixes when a host route cannot be added', async () => {
    const { service } = createService();
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
    expect(disableSpy).toHaveBeenCalledWith({
      sweepHostPrefixes: ['203.0.113.10/32'],
      sweepDefaultRoutes: true,
    });
  });

  it('treats DEFAULT_FAIL as a failed enable and rolls back', async () => {
    const { service } = createService();
    vi.spyOn(service as any, 'waitForTunInterface').mockResolvedValue(7);
    vi.spyOn(service as any, 'runPowerShell').mockResolvedValue(
      ['HOST_CREATED|203.0.113.10/32', 'DEFAULT_FAIL|route add failed'].join(
        '\n',
      ),
    );
    const disableSpy = vi
      .spyOn(service, 'disable')
      .mockResolvedValue(undefined);

    await expect(service.enable(makeServer(), plan)).rejects.toThrow(
      /default route.*route add failed/i,
    );
    expect(disableSpy).toHaveBeenCalledWith({
      sweepHostPrefixes: ['203.0.113.10/32'],
      sweepDefaultRoutes: true,
    });
  });

  it('sweeps the planned prefixes and default routes when the enable script itself fails', async () => {
    const { service } = createService();
    vi.spyOn(service as any, 'waitForTunInterface').mockResolvedValue(7);
    vi.spyOn(service as any, 'runPowerShell').mockRejectedValue(
      new Error('PowerShell exited with code 1'),
    );
    const removeSpy = vi
      .spyOn(service as any, 'removeTunRoutes')
      .mockResolvedValue(undefined);

    await expect(service.enable(makeServer(), plan)).rejects.toThrow(
      'PowerShell exited with code 1',
    );
    expect(removeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        hostPrefixes: ['203.0.113.10/32'],
        removeDefaultRoutes: true,
      }),
    );
  });

  it('recoverOrphanedRoutes does nothing when no session state was persisted', async () => {
    const { service } = createService();
    const runPowerShell = vi.spyOn(service as any, 'runPowerShell');

    await service.recoverOrphanedRoutes();

    expect(runPowerShell).not.toHaveBeenCalled();
  });

  it('recoverOrphanedRoutes leaves the state for an elevated instance when unprivileged', async () => {
    const stateStore = createMemoryTunRouteStateStore({
      version: 1,
      hostPrefixes: ['203.0.113.10/32'],
      hostRouteMetric: 1,
      defaultRoutes: true,
      tunInterfaceIndex: 7,
      updatedAt: Date.now(),
    });
    const service = new TunRouteService('win32', {
      stateStore,
      isElevated: async () => false,
      nativeRouting: null,
    });
    const runPowerShell = vi.spyOn(service as any, 'runPowerShell');

    await service.recoverOrphanedRoutes();

    expect(runPowerShell).not.toHaveBeenCalled();
    expect(stateStore.current).not.toBeNull();
  });

  it('recoverOrphanedRoutes removes the persisted routes in one call and clears the state', async () => {
    vi.mocked(configService.getPerformanceSettings).mockReturnValue({
      ...DEFAULT_PERFORMANCE_SETTINGS,
      windowsTunRouting: 'xray',
    });
    const stateStore = createMemoryTunRouteStateStore({
      version: 1,
      hostPrefixes: ['203.0.113.10/32', '203.0.113.11/32'],
      hostRouteMetric: 1,
      defaultRoutes: true,
      tunInterfaceIndex: 9,
      updatedAt: Date.now(),
    });
    const service = new TunRouteService('win32', {
      stateStore,
      isElevated: async () => true,
      nativeRouting: null,
    });
    const runPowerShell = vi
      .spyOn(service as any, 'runPowerShell')
      .mockResolvedValue('REMOVED|2|2');

    await service.recoverOrphanedRoutes();

    expect(runPowerShell).toHaveBeenCalledTimes(1);
    const script = runPowerShell.mock.calls[0][0] as string;
    expect(script).toContain("'203.0.113.10/32', '203.0.113.11/32'");
    expect(script).toContain('$tunIdx = 9');
    expect(script).not.toContain('Resolve-DnsName');
    expect(stateStore.current).toBeNull();
  });

  it('reapplyRoutesAfterResume is a no-op when TUN routing is inactive', async () => {
    const { service } = createService();
    const runPowerShell = vi.spyOn(service as any, 'runPowerShell');

    await service.reapplyRoutesAfterResume();

    expect(runPowerShell).not.toHaveBeenCalled();
  });

  it('reapplyRoutesAfterResume re-pins host routes via the new gateway', async () => {
    const { service, stateStore } = createService();
    vi.spyOn(service as any, 'waitForTunInterface').mockResolvedValue(7);
    const runPowerShell = vi
      .spyOn(service as any, 'runPowerShell')
      .mockResolvedValue(ENABLE_OUTPUT);
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
    expect(stateStore.current?.hostPrefixes).toEqual(['203.0.113.10/32']);
  });

  it('reapplyRoutesAfterResume skips PowerShell when the gateway is unchanged', async () => {
    const { service } = createService();
    vi.spyOn(service as any, 'waitForTunInterface').mockResolvedValue(7);
    const runPowerShell = vi
      .spyOn(service as any, 'runPowerShell')
      .mockResolvedValue(ENABLE_OUTPUT);
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

    const { service } = createService();
    const runPowerShell = vi.spyOn(service as any, 'runPowerShell');

    await service.enable(makeServer(), plan);

    expect(runPowerShell).not.toHaveBeenCalled();
  });

  it('auto-route enable does not discover default route or DNS without a plan', async () => {
    vi.mocked(configService.getPerformanceSettings).mockReturnValue({
      ...DEFAULT_PERFORMANCE_SETTINGS,
      windowsTunRouting: 'xray',
    });

    const { service } = createService();
    const prepare = vi.spyOn(service, 'prepareRoutingPlan');
    const runPowerShell = vi.spyOn(service as any, 'runPowerShell');

    await service.enable(makeServer());

    expect(prepare).not.toHaveBeenCalled();
    expect(runPowerShell).not.toHaveBeenCalled();
  });
});

describe('TunRouteService native Windows fast path', () => {
  const plan: TunRoutingPlan = {
    defaultRoute: {
      interfaceIndex: 10,
      gateway: '192.168.0.1',
      interfaceName: 'Wi-Fi',
      localAddress: '192.168.0.124',
    },
    proxyIps: ['203.0.113.10'],
  };

  beforeEach(() => {
    vi.mocked(configService.getPerformanceSettings).mockReturnValue({
      ...DEFAULT_PERFORMANCE_SETTINGS,
      windowsTunRouting: 'xray',
    });
  });

  it('discovers the default route natively and never spawns PowerShell', async () => {
    const native = createNativeFake({
      discoverDefaultRoute: vi.fn(async () => plan.defaultRoute),
    });
    const { service } = createService({ native });
    const runPowerShell = vi.spyOn(service as any, 'runPowerShell');

    const routingPlan = await service.prepareRoutingPlan(
      makeServer({ address: '203.0.113.10' }),
      { awaitStableDefaultRoute: false },
    );

    expect(routingPlan).toEqual(plan);
    expect(native.discoverDefaultRoute).toHaveBeenCalledTimes(1);
    expect(runPowerShell).not.toHaveBeenCalled();
  });

  it('falls back to PowerShell discovery when the native tables yield nothing', async () => {
    const native = createNativeFake();
    const { service } = createService({ native });
    const runPowerShell = vi
      .spyOn(service as any, 'runPowerShell')
      .mockResolvedValue('12|192.168.1.1|Ethernet|192.168.1.10');

    const routingPlan = await service.prepareRoutingPlan(
      makeServer({ address: '203.0.113.10' }),
      { awaitStableDefaultRoute: false },
    );

    expect(routingPlan.defaultRoute).toEqual({
      interfaceIndex: 12,
      gateway: '192.168.1.1',
      interfaceName: 'Ethernet',
      localAddress: '192.168.1.10',
    });
    expect(runPowerShell).toHaveBeenCalledTimes(1);
  });

  it('pins host routes with route.exe and records them for teardown', async () => {
    const native = createNativeFake();
    const { service, stateStore } = createService({ native });
    const runPowerShell = vi.spyOn(service as any, 'runPowerShell');

    await service.pinProxyHostRoutes(plan);

    expect(native.addHostRoutes).toHaveBeenCalledWith({
      prefixes: ['203.0.113.10/32'],
      gateway: '192.168.0.1',
      interfaceIndex: 10,
      metric: 1,
    });
    expect(runPowerShell).not.toHaveBeenCalled();
    expect(stateStore.current).toMatchObject({
      hostPrefixes: ['203.0.113.10/32'],
      defaultRoutes: false,
    });
  });

  it('reports a native pin failure with the same error as the PowerShell path', async () => {
    const native = createNativeFake({
      addHostRoutes: vi.fn(async () => ({
        created: [],
        failed: [{ prefix: '203.0.113.10/32', message: 'Access denied' }],
      })),
    });
    const { service } = createService({ native });

    await expect(service.pinProxyHostRoutes(plan)).rejects.toThrow(
      /host route.*203\.0\.113\.10\/32\|Access denied/i,
    );
  });

  it('uses PowerShell for IPv6 pins the native path cannot express', async () => {
    const native = createNativeFake();
    const { service } = createService({ native });
    const runPowerShell = vi
      .spyOn(service as any, 'runPowerShell')
      .mockResolvedValue('HOST_CREATED|2001:db8::10/128');

    await service.pinProxyHostRoutes({
      ...plan,
      proxyIps: ['2001:db8::10'],
    });

    expect(native.addHostRoutes).not.toHaveBeenCalled();
    expect(runPowerShell).toHaveBeenCalledTimes(1);
  });

  it('removes host pins natively on disable and clears the persisted state', async () => {
    const native = createNativeFake();
    const { service, stateStore } = createService({ native });
    const runPowerShell = vi.spyOn(service as any, 'runPowerShell');
    await service.pinProxyHostRoutes(plan);

    await service.disable();

    expect(native.removeHostRoutes).toHaveBeenCalledWith(['203.0.113.10/32']);
    expect(runPowerShell).not.toHaveBeenCalled();
    expect(stateStore.current).toBeNull();
  });

  it('keeps the state when a pin survives the native removal', async () => {
    const native = createNativeFake({
      removeHostRoutes: vi.fn(async () => ({
        removed: 0,
        remaining: ['203.0.113.10/32'],
      })),
    });
    const { service, stateStore } = createService({ native });
    await service.pinProxyHostRoutes(plan);

    await service.disable();

    expect(stateStore.current).not.toBeNull();
  });

  it('recovers orphaned host pins natively but leaves TUN default routes to PowerShell', async () => {
    const native = createNativeFake();
    const hostOnly = createMemoryTunRouteStateStore({
      version: 1,
      hostPrefixes: ['203.0.113.10/32'],
      hostRouteMetric: 1,
      defaultRoutes: false,
      tunInterfaceIndex: null,
      updatedAt: Date.now(),
    });
    const service = new TunRouteService('win32', {
      stateStore: hostOnly,
      isElevated: async () => true,
      nativeRouting: native,
    });
    const runPowerShell = vi.spyOn(service as any, 'runPowerShell');

    await service.recoverOrphanedRoutes();
    expect(native.removeHostRoutes).toHaveBeenCalledWith(['203.0.113.10/32']);
    expect(runPowerShell).not.toHaveBeenCalled();
    expect(hostOnly.current).toBeNull();

    const withDefaults = createMemoryTunRouteStateStore({
      version: 1,
      hostPrefixes: ['203.0.113.10/32'],
      hostRouteMetric: 1,
      defaultRoutes: true,
      tunInterfaceIndex: 7,
      updatedAt: Date.now(),
    });
    const legacy = new TunRouteService('win32', {
      stateStore: withDefaults,
      isElevated: async () => true,
      nativeRouting: native,
    });
    const legacyPowerShell = vi
      .spyOn(legacy as any, 'runPowerShell')
      .mockResolvedValue('REMOVED|1|2');

    await legacy.recoverOrphanedRoutes();
    expect(native.removeHostRoutes).toHaveBeenCalledTimes(1);
    expect(legacyPowerShell).toHaveBeenCalledTimes(1);
    expect(withDefaults.current).toBeNull();
  });

  it('re-pins after resume through the native path', async () => {
    const native = createNativeFake();
    const { service } = createService({ native });
    await service.pinProxyHostRoutes(plan);
    vi.spyOn(service as any, 'waitForDefaultRoute').mockResolvedValue({
      interfaceIndex: 21,
      gateway: '10.0.0.1',
      interfaceName: 'Ethernet',
      localAddress: '10.0.0.5',
    });

    await service.reapplyRoutesAfterResume();

    expect(native.addHostRoutes).toHaveBeenLastCalledWith({
      prefixes: ['203.0.113.10/32'],
      gateway: '10.0.0.1',
      interfaceIndex: 21,
      metric: 1,
    });
  });
});
