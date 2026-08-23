import { describe, expect, it, vi } from 'vitest';
import { IPC_INVOKE_CHANNELS } from '@/shared/ipc';
import { registerHandlers } from './registerHandlers';

const ipcHandleMock = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  ipcMain: { handle: ipcHandleMock },
}));

vi.mock('@/main/services/ConnectionController', () => ({
  ConnectionControllerRelaunchError: class ConnectionControllerRelaunchError extends Error {
    public readonly relaunched = true;
  },
}));

describe('registerHandlers', () => {
  it('registers the current thin IPC surface', () => {
    ipcHandleMock.mockReset();

    registerHandlers({
      deps: {
        app: { getVersion: vi.fn(() => 'test') },
        shell: { openExternal: vi.fn() },
        configService: {
          getSelectedServerId: vi.fn(() => null),
          setSelectedServerId: vi.fn(),
          getConnectionMode: vi.fn(() => 'proxy'),
          setConnectionMode: vi.fn(),
          getPerformanceSettings: vi.fn(),
          setPerformanceSettings: vi.fn(),
        },
        subscriptionRepository: {
          add: vi.fn(),
          update: vi.fn(),
          remove: vi.fn(),
          getManualLinks: vi.fn(() => ''),
          setManualLinks: vi.fn(),
          list: vi.fn(() => []),
        },
        serverRepository: {
          list: vi.fn(() => []),
          saveAll: vi.fn(),
        },
        connectionController: {
          isBusy: vi.fn(() => false),
          getPhase: vi.fn(() => 'idle'),
        },
        connectionMonitorService: {
          getStatus: vi.fn(() => ({ blockedServers: [] })),
          getAutoSwitchingEnabled: vi.fn(() => true),
          setAutoSwitchingEnabled: vi.fn(),
          clearBlockedServers: vi.fn(),
        },
        xrayService: {
          isRunning: vi.fn(() => false),
          getHealthStatus: vi.fn(() => ({})),
        },
        appRecoveryService: { getStatus: vi.fn(() => ({})) },
        logExportService: {
          getExportableLogs: vi.fn(),
          openLogFolder: vi.fn(),
        },
        tunRouteService: {
          isSupported: vi.fn(() => true),
          getUnsupportedReason: vi.fn(() => null),
          getRouteMode: vi.fn(() => 'windows-auto-route'),
          getDegradedReason: vi.fn(() => null),
        },
        hasTunPrivileges: vi.fn(async () => true),
        mainLocaleService: {
          getLanguage: vi.fn(() => 'en'),
          setLanguage: vi.fn(),
        },
        appUpdaterService: {
          getStatus: vi.fn(),
          checkForUpdates: vi.fn(),
          quitAndInstall: vi.fn(),
        },
        pingService: {},
        trafficStatsService: { getLastSnapshot: vi.fn(() => null) },
      } as any,
      assertTrustedSender: vi.fn(),
      notifySnapshot: vi.fn(),
      queueRefreshAllSubscriptions: vi.fn(),
      restartAutoRefreshTimer: vi.fn(),
    });

    const channels = ipcHandleMock.mock.calls.map(([channel]) => channel);
    expect(channels).toEqual(
      expect.arrayContaining([
        IPC_INVOKE_CHANNELS.getAppSnapshot,
        IPC_INVOKE_CHANNELS.connect,
        IPC_INVOKE_CHANNELS.disconnect,
        IPC_INVOKE_CHANNELS.addSubscription,
        IPC_INVOKE_CHANNELS.pingAllServers,
        IPC_INVOKE_CHANNELS.getConnectionMonitorStatus,
        IPC_INVOKE_CHANNELS.getUpdateStatus,
      ]),
    );
  });
});
