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
    const deps = {
      shell: { openExternal: vi.fn() },
      configService: {
        setConnectionMode: vi.fn(),
        getConnectionMode: vi.fn(() => 'proxy'),
        setSelectedServerId: vi.fn(),
        getPerformanceSettings: vi.fn(),
        setPerformanceSettings: vi.fn(),
      },
      tunRouteService: {
        isSupported: vi.fn(() => true),
        getUnsupportedReason: vi.fn(() => null),
        getRouteMode: vi.fn(() => 'windows-auto-route'),
        getDegradedReason: vi.fn(() => null),
      },
      xrayService: { isRunning: vi.fn(() => false) },
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
    });
    return deps;
  }

  it('refuses connection mode changes while Xray is running', () => {
    registerWith({ xrayService: { isRunning: vi.fn(() => true) } });
    const handler = handlers.get(IPC_INVOKE_CHANNELS.setConnectionMode)!;

    expect(() => handler({} as never, 'tun')).toThrow(
      'Disconnect before changing connection mode.',
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
