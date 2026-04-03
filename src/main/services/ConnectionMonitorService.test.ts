import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import { makeServer } from '../../test/factories';

const mockState = vi.hoisted(() => ({
  tempDir: '',
}));
const configServiceMock = vi.hoisted(() => ({
  getServers: vi.fn(() => []),
  getConnectionMode: vi.fn(() => 'proxy'),
  setSelectedServerId: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => mockState.tempDir),
  },
}));

vi.mock('./ConfigService', () => ({
  configService: configServiceMock,
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

  afterEach(() => {
    fs.rmSync(mockState.tempDir, { recursive: true, force: true });
    configServiceMock.getServers.mockReset();
    configServiceMock.getServers.mockReturnValue([]);
    configServiceMock.getConnectionMode.mockReset();
    configServiceMock.getConnectionMode.mockReturnValue('proxy');
    configServiceMock.setSelectedServerId.mockReset();
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

    svc.on('error', () => {});
    svc.startMonitoring(server);
    fs.appendFileSync(logPath, 'failed to dial new-server\n', 'utf8');

    await vi.advanceTimersByTimeAsync(30_000);

    expect(svc.getStatus().lastError).toContain('failed to dial');
    expect(svc.getStatus().blockedServers).toContain(server.uuid);
  });

  it('marks the current server as blocked when recordError receives a blocking error', async () => {
    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();
    const server = makeServer({ uuid: 'blocked-server' });

    svc.on('error', () => {});
    svc.startMonitoring(server);
    svc.recordError('connection refused by upstream');

    expect(svc.getStatus().blockedServers).toEqual(['blocked-server']);
    expect(svc.getStatus().lastError).toBe('connection refused by upstream');
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
});
