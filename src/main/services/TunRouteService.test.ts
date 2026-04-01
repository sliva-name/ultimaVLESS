import { afterEach, describe, expect, it, vi } from 'vitest';

function setPlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', {
    value,
    configurable: true,
  });
}

describe('TunRouteService support policy', () => {
  const originalPlatform = process.platform;

  async function loadService() {
    vi.resetModules();
    vi.doMock('./ConfigService', () => ({
      configService: {
        getServers: vi.fn(() => []),
      },
    }));
    const mod = await import('./TunRouteService');
    return mod.TunRouteService;
  }

  afterEach(() => {
    setPlatform(originalPlatform);
    vi.resetModules();
    vi.doUnmock('./ConfigService');
  });

  it('reports darwin as unsupported for bundled Xray TUN mode', async () => {
    setPlatform('darwin');
    const TunRouteService = await loadService();
    const service = new TunRouteService();

    expect(service.isSupported()).toBe(false);
    expect(service.getUnsupportedReason()).toMatch(/Windows and Linux/);
  });
});
