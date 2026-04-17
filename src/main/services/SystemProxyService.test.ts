import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMockChildProcess } from '@/test/mockChildProcess';

const mockState = vi.hoisted(() => ({
  tempDir: '',
}));
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => mockState.tempDir),
  },
}));

vi.mock('child_process', () => ({
  spawn: spawnMock,
  default: { spawn: spawnMock },
  __esModule: true,
}));

describe('SystemProxyService', () => {
  function getSpawnCommands(): Array<{ command: string; args: string[] }> {
    return spawnMock.mock.calls.map(([command, args]) => ({
      command: command as string,
      args: args as string[],
    }));
  }

  function getPowerShellCommands(): string[] {
    return getSpawnCommands()
      .filter(({ args }) => args.includes('-Command'))
      .map(({ args }) => String(args[args.indexOf('-Command') + 1] ?? ''));
  }

  function hasFileInvocation(enable: string, proxy?: string): boolean {
    return getSpawnCommands().some(({ args }) => {
      if (!args.includes('-File')) return false;
      const fileIndex = args.indexOf('-File');
      return (
        typeof args[fileIndex + 1] === 'string' &&
        args[fileIndex + 2] === enable &&
        (proxy === undefined || args[fileIndex + 3] === proxy)
      );
    });
  }

  async function loadService() {
    vi.resetModules();
    const mod = await import('./SystemProxyService');
    return mod.SystemProxyService;
  }

  beforeEach(() => {
    mockState.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultima-proxy-'));
    spawnMock.mockReset();
    spawnMock.mockImplementation((_command: string, args: string[]) => {
      const child = createMockChildProcess();

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

  afterEach(async () => {
    const { logger } = await import('./LoggerService');
    await logger.flush();
    fs.rmSync(mockState.tempDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('captures the current Windows proxy state before enabling the app proxy', async () => {
    const SystemProxyService = await loadService();
    const service = new SystemProxyService('win32');
    const proxyString = 'http=127.0.0.1:10809;https=127.0.0.1:10809;socks=127.0.0.1:10808';

    await service.enable(10809, 10808);

    expect(fs.existsSync(path.join(mockState.tempDir, 'system-proxy-state.json'))).toBe(true);
    expect(getPowerShellCommands().some((command) => command.includes('ConvertTo-Json -Compress'))).toBe(true);
    expect(hasFileInvocation('1', proxyString)).toBe(true);
  });

  it('restores a saved Windows snapshot on disable instead of falling back to proxy-off script', async () => {
    fs.writeFileSync(
      path.join(mockState.tempDir, 'system-proxy-state.json'),
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
    const service = new SystemProxyService('win32');
    await service.disable();

    expect(fs.existsSync(path.join(mockState.tempDir, 'system-proxy-state.json'))).toBe(false);
    expect(getPowerShellCommands().some((command) => command.includes('ConvertFrom-Json'))).toBe(true);
    expect(hasFileInvocation('0')).toBe(false);
  });

  it('falls back to the raw Windows disable script when no snapshot exists', async () => {
    const SystemProxyService = await loadService();
    const service = new SystemProxyService('win32');

    await service.disable();

    expect(getPowerShellCommands()).toHaveLength(0);
    expect(hasFileInvocation('0', '')).toBe(true);
  });

  it('treats PowerShell stderr from the proxy script as a failure', async () => {
    spawnMock.mockImplementation((_command: string, args: string[]) => {
      const child = createMockChildProcess();

      queueMicrotask(() => {
        if (args.includes('-File')) {
          child.stderr.emit('data', 'Set-ItemProperty failed');
          child.emit('close', 1);
          return;
        }
        if (args.includes('-Command')) {
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
        child.emit('close', 0);
      });

      return child;
    });

    const SystemProxyService = await loadService();
    const service = new SystemProxyService('win32');

    await expect(service.enable(10809, 10808)).rejects.toThrow('Proxy script exited with code 1');
  });

  it('configures Linux proxy commands through gsettings', async () => {
    const SystemProxyService = await loadService();
    const service = new SystemProxyService('linux');

    await service.enable(10809, 10808);

    expect(getSpawnCommands()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'gsettings',
          args: ['writable', 'org.gnome.system.proxy', 'mode'],
        }),
        expect.objectContaining({
          command: 'gsettings',
          args: ['set', 'org.gnome.system.proxy', 'mode', 'manual'],
        }),
        expect.objectContaining({
          command: 'gsettings',
          args: ['set', 'org.gnome.system.proxy.http', 'port', '10809'],
        }),
        expect.objectContaining({
          command: 'gsettings',
          args: ['set', 'org.gnome.system.proxy.socks', 'port', '10808'],
        }),
      ])
    );
  });

  it('reports Linux proxy control as unsupported when gsettings is unavailable', async () => {
    spawnMock.mockImplementationOnce((_command: string, _args: string[]) => {
      const child = createMockChildProcess();
      queueMicrotask(() => {
        child.stderr.emit('data', 'command not found');
        child.emit('close', 1);
      });
      return child;
    });

    const SystemProxyService = await loadService();
    const service = new SystemProxyService('linux');

    await expect(service.enable(10809, 10808)).rejects.toThrow(
      'Linux system proxy control currently requires a GNOME-compatible desktop with gsettings available.'
    );
  });

  it('does nothing on unsupported platforms', async () => {
    const SystemProxyService = await loadService();
    const service = new SystemProxyService('freebsd');

    await service.enable(10809, 10808);
    await service.disable();

    expect(spawnMock).not.toHaveBeenCalled();
  });
});
