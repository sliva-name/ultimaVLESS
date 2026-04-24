import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import { makeServer } from '@/test/factories';

const mockState = vi.hoisted(() => ({
  tempDir: '',
}));
const configServiceMock = vi.hoisted(() => ({
  getServers: vi.fn(() => []),
  getConnectionMode: vi.fn(() => 'proxy'),
  setSelectedServerId: vi.fn(),
}));
const probeTcpPortMock = vi.hoisted(() => vi.fn(async () => true));
const probeHttpThroughProxyMock = vi.hoisted(() => vi.fn(async () => true));
const xrayServiceMock = vi.hoisted(() => ({
  getHealthStatus: vi.fn(() => ({
    state: 'running',
    ready: true,
    xrayRunning: true,
    lastStartAt: Date.now(),
    lastReadyAt: Date.now(),
    lastReadinessCheckAt: Date.now(),
    localProxyReachable: true,
    lastFailureAt: null,
    lastFailureReason: null,
    lastReadinessError: null,
  })),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => mockState.tempDir),
  },
}));

vi.mock('./ConfigService', () => ({
  configService: configServiceMock,
}));

vi.mock('./networkProbe', () => ({
  probeTcpPort: probeTcpPortMock,
  probeHttpThroughProxy: probeHttpThroughProxyMock,
}));

vi.mock('./XrayService', () => ({
  xrayService: xrayServiceMock,
}));

describe('ConnectionMonitorService', () => {
  let logPath: string;

  async function loadService() {
    vi.resetModules();
    const mod = await import('./ConnectionMonitorService');
    return mod.ConnectionMonitorService;
  }

  beforeEach(() => {
    const baseTempDir = process.env.TEMP || process.env.TMP || process.cwd();
    mockState.tempDir = fs.mkdtempSync(`${baseTempDir}/ultima-monitor-`);
    logPath = `${mockState.tempDir}/xray.log`;
    vi.useFakeTimers();
  });

  afterEach(async () => {
    const { logger } = await import('./LoggerService');
    await logger.flush();
    fs.rmSync(mockState.tempDir, { recursive: true, force: true });
    configServiceMock.getServers.mockReset();
    configServiceMock.getServers.mockReturnValue([]);
    configServiceMock.getConnectionMode.mockReset();
    configServiceMock.getConnectionMode.mockReturnValue('proxy');
    configServiceMock.setSelectedServerId.mockReset();
    probeTcpPortMock.mockReset();
    probeTcpPortMock.mockResolvedValue(true);
    probeHttpThroughProxyMock.mockReset();
    probeHttpThroughProxyMock.mockResolvedValue(true);
    xrayServiceMock.getHealthStatus.mockReset();
    xrayServiceMock.getHealthStatus.mockReturnValue({
      state: 'running',
      ready: true,
      xrayRunning: true,
      lastStartAt: Date.now(),
      lastReadyAt: Date.now(),
      lastReadinessCheckAt: Date.now(),
      localProxyReachable: true,
      lastFailureAt: null,
      lastFailureReason: null,
      lastReadinessError: null,
    });
    vi.useRealTimers();
    vi.resetModules();
  });

  it('ignores blocking log lines that existed before monitoring started', async () => {
    fs.writeFileSync(logPath, 'failed to dial old-server\n', 'utf8');
    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();
    const server = makeServer({ uuid: 'server-1', name: 'Example' });

    const errorEvents: string[] = [];
    svc.on('error', (event) => {
      errorEvents.push(event.error ?? '');
    });

    svc.startMonitoring(server);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(errorEvents).toHaveLength(0);
    expect(svc.getStatus().lastError).toBeNull();
  });

  it('records new blocking log lines that arrive after monitoring starts', async () => {
    fs.writeFileSync(logPath, 'startup ok\n', 'utf8');
    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();
    const server = makeServer({ uuid: 'server-1', name: 'Example' });

    const errorPromise = new Promise<void>((resolve) => {
      svc.on('error', () => resolve());
    });

    svc.startMonitoring(server);
    fs.appendFileSync(logPath, 'failed to dial new-server\n', 'utf8');

    await vi.advanceTimersByTimeAsync(30_000);
    await errorPromise;

    expect(svc.getStatus().lastError).toContain('failed to dial');
    expect(svc.getStatus().blockedServers).toContain(server.uuid);
    expect(svc.getStatus().lastHealthCheckAt).not.toBeNull();
    expect(svc.getStatus().lastHealthState).toBe('failed');
  });

  it('marks the current server as blocked when recordError receives a blocking error', async () => {
    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();
    const server = makeServer({ uuid: 'blocked-server' });

    svc.on('error', () => {});
    svc.startMonitoring(server);
    svc.recordError('failed to dial upstream');

    expect(svc.getStatus().blockedServers).toEqual(['blocked-server']);
    expect(svc.getStatus().lastError).toBe('failed to dial upstream');
    expect(svc.getStatus().lastHealthState).toBe('failed');
  });

  it('handles unexpected disconnects through the public API', async () => {
    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();
    const server = makeServer({ uuid: 'server-1', name: 'Example' });
    const disconnectedMessages: string[] = [];

    svc.on('error', () => {});
    svc.on('disconnected', (event) => {
      disconnectedMessages.push(event.message ?? '');
    });

    svc.startMonitoring(server);

    expect(svc.handleUnexpectedDisconnect('core exited')).toBe(true);
    expect(disconnectedMessages).toContain('Connection lost: core exited');
    expect(svc.getStatus().isConnected).toBe(false);
    expect(svc.getStatus().lastError).toBe('core exited');
  });

  it('fails health checks when local proxy listeners are unreachable', async () => {
    probeTcpPortMock.mockResolvedValue(false);
    xrayServiceMock.getHealthStatus.mockReturnValue({
      state: 'degraded',
      ready: false,
      xrayRunning: true,
      lastStartAt: Date.now(),
      lastReadyAt: null,
      lastReadinessCheckAt: Date.now(),
      localProxyReachable: false,
      lastFailureAt: Date.now(),
      lastFailureReason: 'listeners unreachable',
      lastReadinessError: 'listeners unreachable',
    });

    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();
    const server = makeServer({ uuid: 'server-1', name: 'Example' });

    svc.on('error', () => {});
    svc.startMonitoring(server);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(svc.getStatus()).toMatchObject({
      lastHealthState: 'degraded',
      localProxyReachable: false,
      lastHealthFailureReason: 'listeners unreachable',
      lastError: 'listeners unreachable',
    });
  });

  it('does not set lastError on the first consecutive HTTP tunnel probe failure', async () => {
    probeHttpThroughProxyMock.mockResolvedValue(false);
    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();
    const server = makeServer({ uuid: 'server-1', name: 'Example' });

    svc.on('error', () => {});
    svc.startMonitoring(server);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(svc.getStatus().lastError).toBeNull();
    expect(svc.getStatus().lastHealthState).toBe('degraded');
    expect(svc.getStatus().lastHealthFailureReason).toContain(
      'Remote endpoint check',
    );
  });

  it('sets lastError after two consecutive HTTP tunnel probe failures', async () => {
    probeHttpThroughProxyMock.mockResolvedValue(false);
    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();
    const server = makeServer({ uuid: 'server-1', name: 'Example' });

    const errors: string[] = [];
    svc.on('error', (e) => errors.push(e.error ?? ''));
    svc.startMonitoring(server);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(svc.getStatus().lastError).toContain('Remote endpoint check');
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it('ignores in-flight health check results after monitoring stops', async () => {
    let releaseProbe: (() => void) | null = null;
    probeTcpPortMock.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          releaseProbe = () => resolve(false);
        }),
    );

    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();
    const server = makeServer({ uuid: 'server-1', name: 'Example' });

    svc.on('error', () => {});
    svc.startMonitoring(server);

    await vi.advanceTimersByTimeAsync(30_000);
    svc.stopMonitoring();
    releaseProbe?.();
    await Promise.resolve();

    expect(svc.getStatus()).toMatchObject({
      isConnected: false,
      currentServer: null,
      lastHealthState: 'idle',
      lastHealthFailureReason: null,
      lastError: null,
    });
  });
});
