import { IpcMainEvent, IpcMainInvokeEvent, BrowserWindow } from 'electron';
import { VlessConfig } from '@/shared/types';
import {
  ConnectionMonitorStatus,
  IPC_EVENT_CHANNELS,
  IpcEventChannel,
} from '@/shared/ipc';
import { toSafeServerList } from '@/shared/serverView';
import { configService } from '@/main/services/ConfigService';
import { subscriptionService } from '@/main/services/SubscriptionService';
import { logger } from '@/main/services/LoggerService';
import { connectionMonitorService } from '@/main/services/ConnectionMonitorService';
import { xrayService } from '@/main/services/XrayService';
import { appRecoveryService } from '@/main/services/AppRecoveryService';
import { trayService } from '@/main/services/TrayService';
import { TrafficSnapshot } from '@/main/services/TrafficStatsService';
import { createIpcDependencies, IpcDependencies } from './dependencies';
import { registerConnectionHandlers } from './handlers/connectionHandlers';
import { registerDiagnosticsHandlers } from './handlers/diagnosticsHandlers';
import { registerPingHandlers } from './handlers/pingHandlers';
import { registerSettingsHandlers } from './handlers/settingsHandlers';
import { registerSubscriptionHandlers } from './handlers/subscriptionHandlers';
import { registerUpdateHandlers } from './handlers/updateHandlers';
import { buildConnectionMonitorStatusSummary } from './connectionStatusSummary';
import { createSubscriptionRefreshManager } from './subscriptionRefresh';
import { loadInitialState as loadInitialStateRuntime } from './initialState';

let windowRef: BrowserWindow | null = null;
let handlersRegistered = false;
let connectionBusy = false;
let connectionBusyCounter = 0;
let unexpectedXrayExitRecovery: Promise<void> | null = null;

function getWindow(): BrowserWindow | null {
  if (windowRef && !windowRef.isDestroyed()) return windowRef;
  return null;
}

function sendToRenderer(channel: IpcEventChannel, ...args: unknown[]) {
  const win = getWindow();
  if (win) {
    win.webContents.send(channel, ...args);
  }
}

function flushConnectionBusy(): void {
  const nextBusy = connectionBusyCounter > 0;
  if (connectionBusy === nextBusy) return;
  connectionBusy = nextBusy;
  sendToRenderer(IPC_EVENT_CHANNELS.connectionBusy, connectionBusy);
}

function beginConnectionBusy(): void {
  connectionBusyCounter += 1;
  flushConnectionBusy();
}

function endConnectionBusy(): void {
  connectionBusyCounter = Math.max(0, connectionBusyCounter - 1);
  flushConnectionBusy();
}

async function handleUnexpectedXrayExit(
  reason: string,
  deps: IpcDependencies,
): Promise<void> {
  if (unexpectedXrayExitRecovery) {
    return unexpectedXrayExitRecovery;
  }

  const monitorStatus = deps.connectionMonitorService.getStatus();
  if (!monitorStatus.isConnected || !monitorStatus.currentServer) {
    return;
  }

  unexpectedXrayExitRecovery = (async () => {
    const message = `Connection lost: ${reason}`;
    logger.error('IPC', 'Handling unexpected Xray exit', {
      reason,
      serverId: monitorStatus.currentServer?.uuid.substring(0, 8),
    });
    beginConnectionBusy();
    try {
      const autoSwitchScheduled =
        deps.connectionMonitorService.handleCriticalConnectionFailure(message, {
          localProxyReachable: false,
        });
      if (!autoSwitchScheduled) {
        deps.connectionMonitorService.handleUnexpectedDisconnect(message);
      }
      sendToRenderer(IPC_EVENT_CHANNELS.connectionError, message);
      await deps.connectionStackService.cleanupAfterFailure();
    } catch (error) {
      logger.error(
        'IPC',
        'Failed to recover after unexpected Xray exit',
        error,
      );
    } finally {
      endConnectionBusy();
      unexpectedXrayExitRecovery = null;
    }
  })();

  return unexpectedXrayExitRecovery;
}

async function handlePendingTunReconnectFailure(
  error: unknown,
  deps: IpcDependencies,
  emitErrorOnFailure: boolean,
): Promise<false> {
  logger.error('IPC', 'Pending TUN reconnect failed', error);
  try {
    await deps.connectionStackService.cleanupAfterFailure();
  } catch (cleanupError) {
    logger.error(
      'IPC',
      'Failed to cleanup network stack after pending reconnect failure',
      cleanupError,
    );
  }

  if (emitErrorOnFailure) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    deps.connectionMonitorService.recordError(errorMessage);
    sendToRenderer(
      IPC_EVENT_CHANNELS.connectionError,
      `Auto-connect failed: ${errorMessage}`,
    );
  }
  return false;
}

function assertTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): void {
  const win = getWindow();
  if (!win || event.sender.id !== win.webContents.id) {
    throw new Error('Blocked IPC request from untrusted sender');
  }
}

export function buildConnectionMonitorStatus(
  deps: {
    connectionMonitorService: Pick<
      typeof connectionMonitorService,
      'getStatus' | 'getAutoSwitchingEnabled'
    >;
    xrayService: Pick<typeof xrayService, 'getHealthStatus'>;
    appRecoveryService: Pick<typeof appRecoveryService, 'getStatus'>;
  } = {
    connectionMonitorService,
    xrayService,
    appRecoveryService,
  },
): ConnectionMonitorStatus {
  const status = deps.connectionMonitorService.getStatus();
  return buildConnectionMonitorStatusSummary(
    status,
    deps.connectionMonitorService.getAutoSwitchingEnabled(),
    deps.xrayService.getHealthStatus(),
    deps.appRecoveryService.getStatus(),
  );
}

const subscriptionRefreshManager = createSubscriptionRefreshManager({
  getWindow,
  configService,
  subscriptionService,
  connectionMonitorService,
  xrayService,
});

const {
  queueRefreshAllSubscriptions,
  restartAutoRefreshTimer,
  stopAutoRefreshTimer,
  reportSubscriptionRefreshIssue,
} = subscriptionRefreshManager;

async function attemptPendingTunReconnect(
  serverId: string,
  deps: IpcDependencies,
  options: { emitErrorOnFailure: boolean } = { emitErrorOnFailure: true },
): Promise<boolean> {
  const { emitErrorOnFailure } = options;
  const serverIdPreview = serverId.substring(0, 8);
  beginConnectionBusy();
  try {
    const connectionMode = deps.configService.getConnectionMode();
    if (connectionMode !== 'tun') {
      logger.info('IPC', 'Skipping pending TUN reconnect: mode changed', {
        serverId: serverIdPreview,
        connectionMode,
      });
      return false;
    }

    const fullConfig = deps.configService
      .getServers()
      .find((s) => s.uuid === serverId);
    if (!fullConfig) {
      logger.warn(
        'IPC',
        'Pending TUN reconnect server not found in local configuration',
        {
          serverId: serverIdPreview,
        },
      );
      return false;
    }

    const monitorStatus = deps.connectionMonitorService.getStatus();
    if (
      deps.xrayService.isRunning() &&
      monitorStatus.isConnected &&
      monitorStatus.currentServer?.uuid === fullConfig.uuid
    ) {
      logger.info('IPC', 'Pending TUN reconnect skipped: already connected', {
        serverId: serverIdPreview,
      });
      return true;
    }

    if (!deps.tunRouteService.isSupported()) {
      return handlePendingTunReconnectFailure(
        new Error(
          deps.tunRouteService.getUnsupportedReason() ||
            'TUN mode is not supported on this operating system.',
        ),
        deps,
        emitErrorOnFailure,
      );
    }

    if (!(await deps.hasTunPrivileges())) {
      return handlePendingTunReconnectFailure(
        new Error('Pending TUN reconnect requires elevated privileges'),
        deps,
        emitErrorOnFailure,
      );
    }

    logger.info('IPC', 'Applying pending TUN reconnect', {
      serverId: serverIdPreview,
      serverName: fullConfig.name,
    });
    await deps.connectionStackService.transitionTo(
      fullConfig,
      'tun',
      deps.constants.ports,
      {
        stopXray: true,
      },
    );
    deps.configService.setSelectedServerId(fullConfig.uuid);
    deps.connectionMonitorService.startMonitoring(fullConfig);
    return true;
  } catch (error) {
    return handlePendingTunReconnectFailure(error, deps, emitErrorOnFailure);
  } finally {
    endConnectionBusy();
  }
}

export function registerIpcHandlers(
  mainWindow: BrowserWindow,
  deps: IpcDependencies = createIpcDependencies(),
) {
  windowRef = mainWindow;
  if (handlersRegistered) {
    return;
  }
  handlersRegistered = true;

  deps.xrayService.removeAllListeners('unexpected-exit');
  deps.xrayService.on('unexpected-exit', (event) => {
    void handleUnexpectedXrayExit(event.reason, deps);
  });
  deps.xrayService.removeAllListeners('health-changed');
  deps.xrayService.on('health-changed', (healthStatus) => {
    deps.connectionMonitorService.handleXrayHealthStatusChanged(healthStatus);
  });
  deps.connectionMonitorService.removeAllListeners('switch-operation-started');
  deps.connectionMonitorService.removeAllListeners('switch-operation-finished');
  deps.connectionMonitorService.on('switch-operation-started', () => {
    beginConnectionBusy();
  });
  deps.connectionMonitorService.on('switch-operation-finished', () => {
    endConnectionBusy();
  });

  deps.trafficStatsService.removeAllListeners('snapshot');
  deps.trafficStatsService.on('snapshot', (snapshot: TrafficSnapshot) => {
    sendToRenderer(IPC_EVENT_CHANNELS.trafficStats, snapshot);
  });
  deps.trafficStatsService.removeAllListeners('stopped');
  deps.trafficStatsService.on('stopped', () => {
    sendToRenderer(IPC_EVENT_CHANNELS.trafficStats, null);
  });

  deps.appUpdaterService.removeAllListeners('status');
  deps.appUpdaterService.on('status', (status) => {
    sendToRenderer(IPC_EVENT_CHANNELS.updateStatus, status);
  });
  // The updater needs to know about TUN setup / server-switch transitions so
  // it can defer network calls instead of surfacing
  // `net::ERR_ADDRESS_UNREACHABLE` while the default route is being swapped.
  deps.appUpdaterService.setConnectionBusyGetter(() => connectionBusy);

  registerSubscriptionHandlers({
    deps,
    assertTrustedSender,
    sendToRenderer,
    queueRefreshAllSubscriptions,
    restartAutoRefreshTimer,
  });

  registerConnectionHandlers({
    deps,
    assertTrustedSender,
    sendToRenderer,
    beginConnectionBusy,
    endConnectionBusy,
  });

  registerSettingsHandlers({
    deps,
    assertTrustedSender,
    isConnectionBusy: () => connectionBusy,
  });

  registerPingHandlers({
    deps,
    sendToRenderer,
    toSafeServerList,
    assertTrustedSender,
    isConnectionBusy: () => connectionBusy,
  });

  registerDiagnosticsHandlers({
    deps,
    assertTrustedSender,
  });

  const monitorEvents = [
    'connected',
    'disconnected',
    'error',
    'blocked',
    'switching',
  ] as const;
  for (const eventName of monitorEvents) {
    connectionMonitorService.on(eventName, (event) => {
      const safeEvent = { ...event };
      if (safeEvent.server) {
        const { rawConfig: _rawConfig, ...restServer } = safeEvent.server;
        safeEvent.server = restServer as VlessConfig;
      }
      sendToRenderer(IPC_EVENT_CHANNELS.connectionMonitorEvent, safeEvent);
      if (eventName === 'connected' && event.server) {
        sendToRenderer(IPC_EVENT_CHANNELS.connectionStatus, true);
        trayService.setConnected(event.server.name, event.server.ping ?? null);
        const connectedAt =
          deps.connectionMonitorService.getStatus().lastConnectionTime ??
          Date.now();
        deps.trafficStatsService.start(connectedAt);
      }
      if (eventName === 'disconnected') {
        sendToRenderer(IPC_EVENT_CHANNELS.connectionStatus, false);
        trayService.setDisconnected();
        deps.trafficStatsService.stop();
      }
      if (eventName === 'error') {
        const message =
          (event as { error?: string; message?: string }).error ??
          (event as { message?: string }).message ??
          '';
        if (message) {
          trayService.reportError(message);
        }
      }
      if (eventName === 'switching') {
        trayService.reportSwitching();
      }
    });
  }

  registerUpdateHandlers({
    deps,
    assertTrustedSender,
  });
}

// ---------------------------------------------------------------------------
// Initial state loader
// ---------------------------------------------------------------------------

export async function loadInitialState(window: BrowserWindow) {
  windowRef = window;
  await loadInitialStateRuntime(
    window,
    {
      sendToRenderer,
      queueRefreshAllSubscriptions,
      reportSubscriptionRefreshIssue,
      restartAutoRefreshTimer,
      attemptPendingTunReconnect,
    },
    {
      configService,
      connectionMonitorService,
      xrayService,
      createRuntimeDependencies: createIpcDependencies,
      stopAutoRefreshTimer,
    },
  );
}
