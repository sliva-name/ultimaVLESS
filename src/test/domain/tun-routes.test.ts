import { beforeEach, describe, expect, it, vi } from 'vitest';
import dns from 'dns';
import { DEFAULT_PERFORMANCE_SETTINGS } from '@/shared/types';
import { TunRouteService } from '@/main/services/TunRouteService';
import {
  createMemoryTunRouteStateStore,
  type TunRouteState,
} from '@/main/services/tunRoute/routeStateStore';
import type { WindowsNativeRouting } from '@/main/services/tunRoute/windowsNativeRouting';
import { configService } from '@/main/services/ConfigService';
import { makeServer } from '@/test/factories';

vi.mock('@/main/services/ConfigService', () => ({
  configService: {
    getPerformanceSettings: vi.fn(() => ({})),
  },
}));

vi.mock('@/main/services/tunRoute/platformAdapter', () => ({
  createPlatformTunAdapter: () => ({
    isSupported: () => true,
    getUnsupportedReason: () => null,
    getRouteMode: () => 'windows-xray-auto-route',
    getDegradedReason: () => null,
  }),
}));

vi.mock('@/main/services/tunRoute/powerShellRunner', () => ({
  runPowerShell: vi.fn(async () => ''),
}));

const DEFAULT_ROUTE = {
  interfaceIndex: 10,
  gateway: '192.168.0.1',
  interfaceName: 'Wi-Fi',
  localAddress: '192.168.0.124',
};

function legacyState(overrides: Partial<TunRouteState> = {}): TunRouteState {
  return {
    version: 1,
    hostPrefixes: ['203.0.113.10/32'],
    hostRouteMetric: 1,
    defaultRoutes: false,
    tunInterfaceIndex: null,
    updatedAt: Date.now(),
    ...overrides,
  };
}

function createNativeFake(
  overrides: Partial<WindowsNativeRouting> = {},
): WindowsNativeRouting & {
  discoverDefaultRoute: ReturnType<typeof vi.fn>;
  removeHostRoutes: ReturnType<typeof vi.fn>;
} {
  return {
    discoverDefaultRoute: vi.fn(async () => null),
    listAdapters: vi.fn(async () => []),
    removeHostRoutes: vi.fn(async (prefixes: string[]) => ({
      removed: prefixes.length,
      remaining: [],
    })),
    ...overrides,
  } as WindowsNativeRouting & {
    discoverDefaultRoute: ReturnType<typeof vi.fn>;
    removeHostRoutes: ReturnType<typeof vi.fn>;
  };
}

function createService(
  options: {
    elevated?: boolean;
    native?: WindowsNativeRouting | null;
    interfaceNames?: string[];
    state?: TunRouteState | null;
  } = {},
) {
  const stateStore = createMemoryTunRouteStateStore(options.state ?? null);
  const service = new TunRouteService('win32', {
    stateStore,
    isElevated: async () => options.elevated ?? true,
    nativeRouting:
      options.native === undefined ? createNativeFake() : options.native,
    listInterfaceNames: () => options.interfaceNames ?? ['Wi-Fi', 'Ethernet'],
  });
  return { service, stateStore };
}

beforeEach(() => {
  vi.mocked(configService.getPerformanceSettings).mockReturnValue({
    ...DEFAULT_PERFORMANCE_SETTINGS,
  });
});

describe('TunRouteService routing plan (Windows)', () => {
  it('discovers the default route natively and never spawns PowerShell', async () => {
    const native = createNativeFake({
      discoverDefaultRoute: vi.fn(async () => DEFAULT_ROUTE),
    });
    const { service } = createService({ native });
    const runPowerShell = vi.spyOn(service as any, 'runPowerShell');

    const plan = await service.prepareRoutingPlan(
      makeServer({ address: '203.0.113.10' }),
    );

    // Xray binds its sockets to the adapter of the default route.
    expect(plan).toEqual({
      defaultRoute: DEFAULT_ROUTE,
      proxyIps: ['203.0.113.10'],
      outboundInterface: 'Wi-Fi',
    });
    expect(native.discoverDefaultRoute).toHaveBeenCalledTimes(1);
    expect(native.discoverDefaultRoute).toHaveBeenCalledWith(undefined);
    expect(runPowerShell).not.toHaveBeenCalled();
  });

  it('leaves the TUN outbound adapter to Xray when the route has no real adapter name', async () => {
    const native = createNativeFake({
      discoverDefaultRoute: vi.fn(async () => ({
        ...DEFAULT_ROUTE,
        // `route print` description fallback: not an alias Xray can resolve.
        interfaceName: 'Intel(R) Wi-Fi 6E AX210 160MHz',
      })),
    });
    const { service } = createService({ native });

    const plan = await service.prepareRoutingPlan(
      makeServer({ address: '203.0.113.10' }),
    );

    expect(plan.outboundInterface).toBeNull();
  });

  it('discovers and binds through the adapter selected in settings', async () => {
    vi.mocked(configService.getPerformanceSettings).mockReturnValue({
      ...DEFAULT_PERFORMANCE_SETTINGS,
      tunOutboundInterface: 'Беспроводная сеть',
    });
    const wifi = { ...DEFAULT_ROUTE, interfaceName: 'Беспроводная сеть' };
    const native = createNativeFake({
      discoverDefaultRoute: vi.fn(async () => wifi),
    });
    // The selected name is trusted as-is; it need not match Node's list.
    const { service } = createService({ native, interfaceNames: [] });

    const plan = await service.prepareRoutingPlan(
      makeServer({ address: '203.0.113.10' }),
    );

    expect(native.discoverDefaultRoute).toHaveBeenCalledWith(
      'Беспроводная сеть',
    );
    expect(plan.defaultRoute).toEqual(wifi);
    expect(plan.outboundInterface).toBe('Беспроводная сеть');
  });

  it('names the selected adapter when it has no default gateway', async () => {
    vi.mocked(configService.getPerformanceSettings).mockReturnValue({
      ...DEFAULT_PERFORMANCE_SETTINGS,
      tunOutboundInterface: 'Ethernet 2',
    });
    const native = createNativeFake();
    const { service } = createService({ native });
    const runPowerShell = vi
      .spyOn(service as any, 'runPowerShell')
      .mockResolvedValue('');
    vi.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

    await expect(
      service.prepareRoutingPlan(makeServer({ address: '203.0.113.10' })),
    ).rejects.toThrow(
      /"Ethernet 2" selected for TUN has no IPv4 default gateway/,
    );
    expect(native.discoverDefaultRoute).toHaveBeenCalledWith('Ethernet 2');
    // The PowerShell fallback filters by the same alias, passed as base64.
    const script = runPowerShell.mock.calls[0][0] as string;
    expect(script).toContain(
      Buffer.from('Ethernet 2', 'utf8').toString('base64'),
    );
    expect(script).not.toContain("'Ethernet 2'");
  });

  it('falls back to PowerShell discovery when the native tables yield nothing', async () => {
    const { service } = createService();
    const runPowerShell = vi
      .spyOn(service as any, 'runPowerShell')
      .mockResolvedValue('12|192.168.1.1|Ethernet|192.168.1.10');

    const plan = await service.prepareRoutingPlan(
      makeServer({ address: '203.0.113.10' }),
    );

    expect(plan.defaultRoute).toEqual({
      interfaceIndex: 12,
      gateway: '192.168.1.1',
      interfaceName: 'Ethernet',
      localAddress: '192.168.1.10',
    });
    expect(runPowerShell).toHaveBeenCalledTimes(1);
  });

  it('accepts a bracketed IPv6 server address saved by earlier builds', async () => {
    const { service } = createService({
      native: createNativeFake({
        discoverDefaultRoute: vi.fn(async () => DEFAULT_ROUTE),
      }),
    });

    const plan = await service.prepareRoutingPlan(
      makeServer({ address: '[2001:db8::10]' }),
    );

    expect(plan.proxyIps).toEqual(['2001:db8::10']);
  });

  it('prefers IPv4 when DNS returns both families', async () => {
    const lookup = vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
      { address: '2001:db8::10', family: 6 },
      { address: '203.0.113.10', family: 4 },
    ] as unknown as Awaited<ReturnType<typeof dns.promises.lookup>>);
    const { service } = createService({
      native: createNativeFake({
        discoverDefaultRoute: vi.fn(async () => DEFAULT_ROUTE),
      }),
    });

    try {
      const plan = await service.prepareRoutingPlan(
        makeServer({ address: 'vpn.example.com' }),
      );
      expect(plan.proxyIps).toEqual(['203.0.113.10']);
    } finally {
      lookup.mockRestore();
    }
  });

  it('lists network adapters through the native tables on Windows only', async () => {
    const adapters = [
      {
        name: 'Wi-Fi',
        description: 'Intel(R) Wi-Fi 6E AX210 160MHz',
        ipv4: ['192.168.0.124'],
        gateway: '192.168.0.1',
        kind: 'physical' as const,
        isAutomaticChoice: true,
      },
    ];
    const { service } = createService({
      native: createNativeFake({ listAdapters: vi.fn(async () => adapters) }),
    });

    await expect(service.listNetworkAdapters()).resolves.toEqual({
      supported: true,
      adapters,
    });
    await expect(
      new TunRouteService('linux', {
        stateStore: createMemoryTunRouteStateStore(),
      }).listNetworkAdapters(),
    ).resolves.toEqual({ supported: false, adapters: [] });
  });
});

describe('TunRouteService orphaned routes of earlier versions', () => {
  it('does nothing when no session state was persisted', async () => {
    const native = createNativeFake();
    const { service } = createService({ native });

    await service.recoverOrphanedRoutes();

    expect(native.removeHostRoutes).not.toHaveBeenCalled();
  });

  it('leaves the state for an elevated instance when unprivileged', async () => {
    const native = createNativeFake();
    const { service, stateStore } = createService({
      native,
      elevated: false,
      state: legacyState(),
    });

    await service.recoverOrphanedRoutes();

    expect(native.removeHostRoutes).not.toHaveBeenCalled();
    expect(stateStore.current).not.toBeNull();
  });

  it('removes the IPv4 pins with route.exe and clears the state', async () => {
    const native = createNativeFake();
    const { service, stateStore } = createService({
      native,
      // The old static mode's default routes left with the TUN adapter, and
      // IPv6 pins needed PowerShell: neither is touched.
      state: legacyState({
        hostPrefixes: ['203.0.113.10/32', '2001:db8::10/128'],
        defaultRoutes: true,
        tunInterfaceIndex: 7,
      }),
    });
    const runPowerShell = vi.spyOn(service as any, 'runPowerShell');

    await service.recoverOrphanedRoutes();

    expect(native.removeHostRoutes).toHaveBeenCalledWith(['203.0.113.10/32']);
    expect(runPowerShell).not.toHaveBeenCalled();
    expect(stateStore.current).toBeNull();
  });

  it('keeps the state when a pin survives the removal so a later start retries', async () => {
    const native = createNativeFake({
      removeHostRoutes: vi.fn(async () => ({
        removed: 0,
        remaining: ['203.0.113.10/32'],
      })),
    });
    const { service, stateStore } = createService({
      native,
      state: legacyState(),
    });

    await service.recoverOrphanedRoutes();

    expect(stateStore.current).not.toBeNull();
  });
});
