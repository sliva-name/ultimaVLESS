import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { VlessConfig } from '../../shared/types';

const server: VlessConfig = {
  uuid: 'server-1',
  address: 'example.com',
  port: 443,
  name: 'Example',
};

describe('ConnectionMonitorService', () => {
  let tempDir: string;
  let logPath: string;

  async function loadService() {
    vi.resetModules();
    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn(() => tempDir),
      },
    }));
    vi.doMock('electron-store', () => ({
      default: class MockStore {
        path = path.join(tempDir, 'mock-store.json');
        get = vi.fn((key: string) => {
          if (key === 'servers') return [];
          if (key === 'selectedServerId') return null;
          if (key === 'connectionMode') return 'proxy';
          if (key === 'subscriptionUrl') return '';
          if (key === 'manualLinksInput') return '';
          if (key === 'pendingTunReconnect') return null;
          return undefined;
        });
        set = vi.fn();
      },
    }));
    vi.doMock('./ConfigService', () => ({
      configService: {
        getServers: vi.fn(() => []),
        getConnectionMode: vi.fn(() => 'proxy'),
        setSelectedServerId: vi.fn(),
      },
    }));
    const mod = await import('./ConnectionMonitorService');
    return mod.ConnectionMonitorService;
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultima-monitor-'));
    logPath = path.join(tempDir, 'xray.log');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.resetModules();
    vi.doUnmock('electron');
    vi.doUnmock('electron-store');
    vi.doUnmock('./ConfigService');
  });

  it('ignores log errors that existed before monitoring started', async () => {
    fs.writeFileSync(logPath, 'failed to dial old-server\n', 'utf8');
    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();

    const errorEvents: string[] = [];
    svc.on('error', (event) => {
      errorEvents.push(event.error ?? '');
    });

    svc.startMonitoring(server);
    (svc as any).checkConnectionHealth();

    expect(errorEvents).toHaveLength(0);
    expect(svc.getStatus().lastError).toBeNull();
  });

  it('records new blocking errors appended after monitoring starts', async () => {
    fs.writeFileSync(logPath, 'startup ok\n', 'utf8');
    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();

    svc.startMonitoring(server);
    fs.appendFileSync(logPath, 'failed to dial new-server\n', 'utf8');

    (svc as any).checkConnectionHealth();

    expect(svc.getStatus().lastError).toContain('failed to dial');
  });
});
