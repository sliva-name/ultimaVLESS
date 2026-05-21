import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_INVOKE_CHANNELS } from '@/shared/ipc';
import { registerDiagnosticsHandlers } from './diagnosticsHandlers';
import { registerSettingsHandlers } from './settingsHandlers';
import { registerSubscriptionHandlers } from './subscriptionHandlers';
import { registerUpdateHandlers } from './updateHandlers';

const ipcHandleMock = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
    getVersion: vi.fn(() => 'test-version'),
  },
  ipcMain: {
    handle: ipcHandleMock,
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

vi.mock('@/main/services/LoggerService', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function makeDeps() {
  return {
    app: {
      releaseSingleInstanceLock: vi.fn(),
      quit: vi.fn(),
      getVersion: vi.fn(() => 'test-version'),
    },
    shell: {
      openExternal: vi.fn(),
    },
    constants: {
      ports: { http: 10809, socks: 10808 },
    },
    configService: {
      getSubscriptions: vi.fn(() => []),
      addSubscription: vi.fn(),
      updateSubscription: vi.fn(),
      removeSubscription: vi.fn(),
      getManualLinksInput: vi.fn(() => ''),
      setManualLinksInput: vi.fn(),
      getServers: vi.fn(() => []),
      setServers: vi.fn(),
      getSelectedServerId: vi.fn(() => null),
      setSelectedServerId: vi.fn(),
      getConnectionMode: vi.fn(() => 'proxy'),
      setConnectionMode: vi.fn(),
      getPerformanceSettings: vi.fn(),
      setPerformanceSettings: vi.fn(),
    },
    connectionMonitorService: {
      getStatus: vi.fn(() => ({ isConnected: false, currentServer: null })),
      getAutoSwitchingEnabled: vi.fn(() => true),
      setAutoSwitchingEnabled: vi.fn(),
      clearBlockedServers: vi.fn(),
    },
    xrayService: {
      isRunning: vi.fn(() => false),
      getHealthStatus: vi.fn(() => ({
        state: 'stopped',
        ready: false,
        xrayRunning: false,
        lastStartAt: null,
        lastReadyAt: null,
        lastReadinessCheckAt: null,
        localProxyReachable: null,
        lastFailureAt: null,
        lastFailureReason: null,
        lastReadinessError: null,
      })),
    },
    tunRouteService: {
      isSupported: vi.fn(() => true),
      getUnsupportedReason: vi.fn(() => null),
      getRouteMode: vi.fn(() => 'windows-static-routes'),
      getDegradedReason: vi.fn(() => null),
    },
    hasTunPrivileges: vi.fn(async () => true),
    appRecoveryService: {
      getStatus: vi.fn(() => ({
        recoveryInProgress: false,
        recoveryAttemptCount: 0,
        recoveryBlocked: false,
        lastRecoveryAt: null,
        lastRecoveryTrigger: null,
        lastRecoveryOutcome: null,
        lastRecoveryReason: null,
        lastFatalReason: null,
      })),
    },
    logExportService: {
      getExportableLogs: vi.fn(async () => ''),
      openLogFolder: vi.fn(async () => undefined),
    },
    mainLocaleService: {
      getLanguage: vi.fn(() => 'en'),
      setLanguage: vi.fn(),
    },
    appUpdaterService: {
      getStatus: vi.fn(),
      checkForUpdates: vi.fn(),
      quitAndInstall: vi.fn(),
    },
    trafficStatsService: {
      getLastSnapshot: vi.fn(() => null),
    },
  } as never;
}

describe('feature IPC handler registration', () => {
  beforeEach(() => {
    ipcHandleMock.mockReset();
  });

  it('registers extracted subscription, settings, diagnostics, and update channels', () => {
    const deps = makeDeps();
    const assertTrustedSender = vi.fn();

    registerSubscriptionHandlers({
      deps,
      assertTrustedSender,
      sendToRenderer: vi.fn(),
      queueRefreshAllSubscriptions: vi.fn(async () => ({ configCount: 0 })),
      restartAutoRefreshTimer: vi.fn(),
    });
    registerSettingsHandlers({
      deps,
      assertTrustedSender,
      isConnectionBusy: vi.fn(() => false),
    });
    registerDiagnosticsHandlers({ deps, assertTrustedSender });
    registerUpdateHandlers({ deps, assertTrustedSender });

    const registeredChannels = ipcHandleMock.mock.calls.map(
      ([channel]) => channel,
    );
    expect(registeredChannels).toEqual(
      expect.arrayContaining([
        IPC_INVOKE_CHANNELS.addSubscription,
        IPC_INVOKE_CHANNELS.saveManualLinks,
        IPC_INVOKE_CHANNELS.getServers,
        IPC_INVOKE_CHANNELS.setConnectionMode,
        IPC_INVOKE_CHANNELS.getConnectionMonitorStatus,
        IPC_INVOKE_CHANNELS.clearBlockedServers,
        IPC_INVOKE_CHANNELS.getTrafficStats,
        IPC_INVOKE_CHANNELS.checkForUpdates,
      ]),
    );
  });
});
