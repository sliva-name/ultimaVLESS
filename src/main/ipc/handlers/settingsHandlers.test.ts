import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_INVOKE_CHANNELS } from '@/shared/ipc';
import { registerSettingsHandlers } from './settingsHandlers';

const ipcHandleMock = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  ipcMain: { handle: ipcHandleMock },
}));

describe('settings IPC handlers', () => {
  const handlers = new Map<string, (event: unknown, payload?: unknown) => any>();

  beforeEach(() => {
    handlers.clear();
    ipcHandleMock.mockReset();
    ipcHandleMock.mockImplementation((channel: string, handler) => {
      handlers.set(channel, handler);
    });
  });

  function registerWith(overrides: Partial<any> = {}) {
    const notifySnapshot = vi.fn();
    const deps = {
      shell: { openExternal: vi.fn() },
      configService: {
        setConnectionMode: vi.fn(),
        getConnectionMode: vi.fn(() => 'proxy'),
        setSelectedServerId: vi.fn(),
        getPerformanceSettings: vi.fn(),
        setPerformanceSettings: vi.fn(),
      },
      serverRepository: {
        list: vi.fn(() => [{ uuid: 'existing-server' }]),
      },
      tunRouteService: {
        isSupported: vi.fn(() => true),
        getUnsupportedReason: vi.fn(() => null),
        getRouteMode: vi.fn(() => 'windows-auto-route'),
        getDegradedReason: vi.fn(() => null),
      },
      connectionController: {
        getPhase: vi.fn(() => 'idle'),
        isBusy: vi.fn(() => false),
      },
      hasTunPrivileges: vi.fn(async () => true),
      app: { getVersion: vi.fn(() => 'test') },
      mainLocaleService: {
        getLanguage: vi.fn(() => 'en'),
        setLanguage: vi.fn(),
      },
      ...overrides,
    };
    registerSettingsHandlers({
      deps: deps as any,
      assertTrustedSender: vi.fn(),
      notifySnapshot,
    });
    return { ...deps, notifySnapshot };
  }

  it('refuses connection mode changes while the session is live', () => {
    registerWith({
      connectionController: {
        getPhase: vi.fn(() => 'connected'),
        isBusy: vi.fn(() => false),
      },
    });
    const handler = handlers.get(IPC_INVOKE_CHANNELS.setConnectionMode)!;

    expect(() => handler({} as never, 'tun')).toThrow(
      'Disconnect before changing connection mode.',
    );
  });

  it('refuses connection mode changes while the session is in-flight', () => {
    registerWith({
      connectionController: {
        getPhase: vi.fn(() => 'idle'),
        isBusy: vi.fn(() => true),
      },
    });
    const handler = handlers.get(IPC_INVOKE_CHANNELS.setConnectionMode)!;

    expect(() => handler({} as never, 'tun')).toThrow(
      'Disconnect before changing connection mode.',
    );
  });

  it('publishes a snapshot after a successful connection mode change', () => {
    const deps = registerWith();
    const handler = handlers.get(IPC_INVOKE_CHANNELS.setConnectionMode)!;

    expect(handler({} as never, 'tun')).toBe(true);
    expect(deps.configService.setConnectionMode).toHaveBeenCalledWith('tun');
    expect(deps.notifySnapshot).toHaveBeenCalledWith('settings');
  });

  it('rejects selecting a server id that does not exist', () => {
    const deps = registerWith();
    const handler = handlers.get(IPC_INVOKE_CHANNELS.setSelectedServerId)!;

    expect(() => handler({} as never, 'missing-server')).toThrow(
      /not found/i,
    );
    expect(deps.configService.setSelectedServerId).not.toHaveBeenCalled();

    expect(handler({} as never, 'existing-server')).toBe(true);
    expect(deps.configService.setSelectedServerId).toHaveBeenCalledWith(
      'existing-server',
    );
  });

  it('allows only http(s) external URLs', async () => {
    const deps = registerWith();
    const handler = handlers.get(IPC_INVOKE_CHANNELS.openExternalUrl)!;

    await expect(handler({} as never, 'https://example.com')).resolves.toBe(
      true,
    );
    expect(deps.shell.openExternal).toHaveBeenCalledWith(
      'https://example.com',
    );
    await expect(handler({} as never, 'file:///etc/passwd')).rejects.toThrow(
      /Only http\(s\)/,
    );
  });
});
