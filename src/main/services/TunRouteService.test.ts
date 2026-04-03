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
    { platform: 'win32' as const, supported: true, reason: null },
    { platform: 'linux' as const, supported: true, reason: null },
    {
      platform: 'darwin' as const,
      supported: false,
      reason: 'TUN mode is currently supported only on Windows and Linux by the bundled Xray core.',
    },
    {
      platform: 'freebsd' as const,
      supported: false,
      reason: 'TUN mode is not supported on this operating system.',
    },
  ])('reports support policy for $platform', async ({ platform, supported, reason }) => {
    const TunRouteService = await loadService();
    const service = new TunRouteService(platform);

    expect(service.isSupported()).toBe(supported);
    expect(service.getUnsupportedReason()).toBe(reason);
  });

  it('rejects prepareRoutingPlan when platform is unsupported', async () => {
    const TunRouteService = await loadService();
    const service = new TunRouteService('darwin');

    await expect(
      service.prepareRoutingPlan({
        uuid: 'server-1',
        name: 'Server 1',
        address: 'example.com',
        port: 443,
      })
    ).rejects.toThrow('TUN mode is currently supported only on Windows and Linux by the bundled Xray core.');
  });
});
