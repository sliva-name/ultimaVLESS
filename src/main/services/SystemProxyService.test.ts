import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';

const spawnMock = vi.fn();

describe('SystemProxyService', () => {
  let tempDir: string;

  async function loadService() {
    vi.resetModules();
    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn(() => tempDir),
      },
    }));
    vi.doMock('child_process', () => ({
      spawn: spawnMock,
      default: { spawn: spawnMock },
      __esModule: true,
    }));
    const mod = await import('./SystemProxyService');
    return mod.SystemProxyService;
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultima-proxy-'));
    spawnMock.mockReset();
    spawnMock.mockImplementation((_command: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();

      queueMicrotask(() => {
        if (args.includes('-Command')) {
          const script = args[args.indexOf('-Command') + 1] ?? '';
          if (script.includes('ConvertTo-Json -Compress')) {
            child.stdout.emit(
              'data',
              JSON.stringify({
                platform: 'win32',
                proxyEnable: 0,
                proxyServer: null,
                proxyOverride: null,
                autoConfigUrl: null,
                autoDetect: 0,
              })
            );
          }
        }
        child.emit('close', 0);
      });

      return child;
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.resetModules();
    vi.doUnmock('electron');
    vi.doUnmock('child_process');
  });

  it('captures snapshot before enabling proxy', async () => {
    const SystemProxyService = await loadService();
    const service = new SystemProxyService();

    await service.enable(10809, 10808);

    const snapshotPath = path.join(tempDir, 'system-proxy-state.json');
    expect(fs.existsSync(snapshotPath)).toBe(true);
    expect(spawnMock.mock.calls.some(([, args]) => Array.isArray(args) && args.includes('-Command'))).toBe(true);
    expect(
      spawnMock.mock.calls.some(([, args]) => Array.isArray(args) && args.includes('-File') && args.includes('1'))
    ).toBe(true);
  });

  it('restores saved snapshot on disable instead of raw proxy-off fallback', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'system-proxy-state.json'),
      JSON.stringify({
        platform: 'win32',
        proxyEnable: 1,
        proxyServer: 'http=proxy.local:8080',
        proxyOverride: '<local>',
        autoConfigUrl: null,
        autoDetect: 0,
      }),
      'utf8'
    );

    const SystemProxyService = await loadService();
    const service = new SystemProxyService();
    await service.disable();

    expect(
      spawnMock.mock.calls.some(([, args]) => {
        if (!Array.isArray(args) || !args.includes('-Command')) return false;
        const script = args[args.indexOf('-Command') + 1] ?? '';
        return typeof script === 'string' && script.includes('ConvertFrom-Json');
      })
    ).toBe(true);
    expect(
      spawnMock.mock.calls.some(([, args]) => Array.isArray(args) && args.includes('-File') && args.includes('0'))
    ).toBe(false);
  });
});
