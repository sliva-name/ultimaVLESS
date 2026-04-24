import { beforeEach, describe, expect, it, vi } from 'vitest';
import fsPromises from 'fs/promises';
import { spawn } from 'child_process';
import { XrayService } from './XrayService';
import { ConfigGenerator } from './ConfigGenerator';
import { makeServer } from '@/test/factories';
import { createMockChildProcess } from '@/test/mockChildProcess';
import { probeTcpPort } from './networkProbe';

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    appendFileSync: vi.fn(),
    statSync: vi.fn(() => ({ size: 0 })),
    constants: { F_OK: 0 },
  },
}));
vi.mock('fs/promises', () => ({
  default: {
    writeFile: vi.fn(),
    access: vi.fn(),
    chmod: vi.fn(),
    stat: vi.fn(() => ({ size: 0 })),
    open: vi.fn(),
  }
}));

vi.mock('child_process', () => {
  const spawn = vi.fn();
  return {
    spawn,
    default: { spawn },
    __esModule: true,
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
    isPackaged: false,
  },
}));

vi.mock('./ConfigGenerator', () => ({
  ConfigGenerator: {
    generate: vi.fn(() => ({ outbound: {} })),
  },
}));

vi.mock('./ConfigService', () => ({
  configService: {
    getPerformanceSettings: vi.fn(() => ({
      muxEnabled: true,
      muxConcurrency: 8,
      xudpConcurrency: 16,
      xudpProxyUDP443: 'reject',
      tcpFastOpen: true,
      sniffingRouteOnly: true,
      logLevel: 'warning',
      fingerprint: 'chrome',
      blockAds: true,
      blockBittorrent: true,
      domainStrategy: 'IPIfNonMatch',
    })),
  },
}));

vi.mock('./networkProbe', () => ({
  probeTcpPort: vi.fn(async () => true),
}));

describe('XrayService', () => {
  const mockConfig = makeServer({
    uuid: 'uuid',
    address: 'addr',
    name: 'test',
    security: 'reality',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsPromises.access).mockResolvedValue(undefined);
    vi.mocked(probeTcpPort).mockResolvedValue(true);
  });

  it('writes generated config and spawns Xray with the config path', async () => {
    const svc = new XrayService();
    const mockProcess = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    await svc.start(mockConfig);

    expect(ConfigGenerator.generate).toHaveBeenCalledWith(
      mockConfig,
      expect.stringMatching(/[\\/]tmp[\\/]xray\.log$/),
      'proxy',
      expect.objectContaining({ performanceSettings: expect.any(Object) })
    );
    expect(fsPromises.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]tmp[\\/]config\.json$/),
      JSON.stringify({ outbound: {} }, null, 2)
    );
    expect(spawn).toHaveBeenCalledWith(
      expect.stringMatching(/resources[\\/]+bin[\\/]+xray(\.exe)?$/),
      ['-c', expect.stringMatching(/[\\/]tmp[\\/]config\.json$/)],
      expect.objectContaining({
        env: expect.objectContaining({
          XRAY_LOCATION_ASSET: expect.stringMatching(/resources[\\/]+bin$/),
        }),
      })
    );
    expect(svc.isRunning()).toBe(true);
    expect(svc.getHealthStatus()).toMatchObject({
      state: 'running',
      ready: true,
      xrayRunning: true,
      lastFailureReason: null,
    });
  });

  it('throws when the Xray binary is missing', async () => {
    const svc = new XrayService();
    vi.mocked(fsPromises.access).mockRejectedValue(new Error('ENOENT'));

    await expect(svc.start(mockConfig)).rejects.toThrow('Xray binary not found');
    expect(svc.getHealthStatus()).toMatchObject({
      state: 'failed',
      ready: false,
      xrayRunning: false,
      lastFailureReason: expect.stringContaining('Xray binary not found'),
    });
  });

  it('stops the running child process on demand', async () => {
    const svc = new XrayService();
    const mockProcess = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    await svc.start(mockConfig);
    svc.stop();
    mockProcess.emit('close', 0);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockProcess.kill).toHaveBeenCalledTimes(1);
    expect(svc.isRunning()).toBe(false);
  });

  it('emits unexpected-exit when the child process closes unexpectedly', async () => {
    const svc = new XrayService();
    const mockProcess = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    const onUnexpectedExit = vi.fn();
    svc.on('unexpected-exit', onUnexpectedExit);

    await svc.start(mockConfig);
    mockProcess.emit('close', 17);

    expect(onUnexpectedExit).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 17,
        signal: null,
        config: mockConfig,
      })
    );
    expect(svc.isRunning()).toBe(false);
  });

  it('does not emit unexpected-exit for an expected stop', async () => {
    const svc = new XrayService();
    const mockProcess = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    const onUnexpectedExit = vi.fn();
    svc.on('unexpected-exit', onUnexpectedExit);

    await svc.start(mockConfig);
    svc.stop();
    mockProcess.emit('close', 0);

    expect(onUnexpectedExit).not.toHaveBeenCalled();
    expect(svc.getHealthStatus()).toMatchObject({
      state: 'stopped',
      ready: false,
      xrayRunning: false,
    });
  });

  it('marks Xray as degraded when the local proxy listeners do not become reachable', async () => {
    const svc = new XrayService();
    const mockProcess = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(mockProcess as any);
    vi.mocked(probeTcpPort).mockResolvedValue(false);

    await svc.start(mockConfig);

    expect(svc.getHealthStatus()).toMatchObject({
      state: 'degraded',
      ready: false,
      xrayRunning: true,
      localProxyReachable: false,
      lastReadinessError: expect.stringContaining('did not become reachable'),
    });
  });

  it('waits for the previous process to exit before spawning a new one', async () => {
    const svc = new XrayService();
    const firstProcess = createMockChildProcess();
    const secondProcess = createMockChildProcess();
    vi.mocked(spawn)
      .mockReturnValueOnce(firstProcess as any)
      .mockReturnValueOnce(secondProcess as any);

    await svc.start(mockConfig);

    const restartPromise = svc.start(makeServer({
      uuid: 'uuid-2',
      address: 'addr-2',
      name: 'second',
      security: 'reality',
    }));

    await Promise.resolve();
    expect(spawn).toHaveBeenCalledTimes(1);

    firstProcess.emit('close', 0);
    await restartPromise;

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(svc.getHealthStatus()).toMatchObject({
      state: 'running',
      ready: true,
      xrayRunning: true,
    });
  });
});
