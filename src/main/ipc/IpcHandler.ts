import {
  IpcMainEvent,
  IpcMainInvokeEvent,
  BrowserWindow,
} from 'electron';
import {
  ConnectionMonitorStatus,
  IPC_EVENT_CHANNELS,
  IpcEventChannel,
} from '@/shared/ipc';
import { toSafeConnectionMonitorEvent } from '@/shared/serverView';
import { configService } from '@/main/services/ConfigService';
import { subscriptionService } from '@/main/services/SubscriptionService';
import { logger } from '@/main/services/LoggerService';
import { connectionMonitorService } from '@/main/services/ConnectionMonitorService';
import { xrayService } from '@/main/services/XrayService';
import { appRecoveryService } from '@/main/services/AppRecoveryService';
import { trayService } from '@/main/services/TrayService';
import {
  trafficStatsService,
  TrafficSnapshot,
} from '@/main/services/TrafficStatsService';
import { appUpdaterService } from '@/main/services/AppUpdaterService';
import { createIpcDependencies, IpcDependencies } from './dependencies';
import { registerConnectionHandlers } from './handlers/connectionHandlers';
import { registerPingHandlers } from './handlers/pingHandlers';
import { registerSubscriptionHandlers } from './handlers/subscriptionHandlers';
import { registerSettingsHandlers } from './handlers/settingsHandlers';
import { registerDiagnosticsHandlers } from './handlers/diagnosticsHandlers';
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
      deps.connectionMonitorService.handleUnexpectedDisconnect(message);
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
      throw new Error(
        deps.tunRouteService.getUnsupportedReason() ||
          'TUN mode is not supported on this operating system.',
      );
    }

    if (!(await deps.hasTunPrivileges())) {
      throw new Error('Pending TUN reconnect requires elevated privileges');
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      deps.connectionMonitorService.recordError(errorMessage);
      sendToRenderer(
        IPC_EVENT_CHANNELS.connectionError,
        `Auto-connect failed: ${errorMessage}`,
      );
    }
    return false;
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
  deps.connectionMonitorService.removeAllListeners('switch-operation-started');
  deps.connectionMonitorService.removeAllListeners('switch-operation-finished');
  deps.connectionMonitorService.on('switch-operation-started', () => {
    beginConnectionBusy();
  });
  deps.connectionMonitorService.on('switch-operation-finished', () => {
    endConnectionBusy();
  });

  trafficStatsService.removeAllListeners('snapshot');
  trafficStatsService.on('snapshot', (snapshot: TrafficSnapshot) => {
    sendToRenderer(IPC_EVENT_CHANNELS.trafficStats, snapshot);
  });
  trafficStatsService.removeAllListeners('stopped');
  trafficStatsService.on('stopped', () => {
    sendToRenderer(IPC_EVENT_CHANNELS.trafficStats, null);
  });

  appUpdaterService.removeAllListeners('status');
  appUpdaterService.on('status', (status) => {
    sendToRenderer(IPC_EVENT_CHANNELS.updateStatus, status);
  });
  // The updater needs to know about TUN setup / server-switch transitions so
  // it can defer network calls instead of surfacing
  // `net::ERR_ADDRESS_UNREACHABLE` while the default route is being swapped.
  appUpdaterService.setConnectionBusyGetter(() => connectionBusy);

  registerSubscriptionHandlers({
    assertTrustedSender,
    sendToRenderer,
    queueRefreshAllSubscriptions,
    restartAutoRefreshTimer,
  });

  // -------------------------------------------------------------------------
  // Remaining handlers (unchanged)
  // -------------------------------------------------------------------------

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
      const safeEvent = toSafeConnectionMonitorEvent(event);
      sendToRenderer(IPC_EVENT_CHANNELS.connectionMonitorEvent, safeEvent);
      if (eventName === 'connected' && event.server) {
        sendToRenderer(IPC_EVENT_CHANNELS.connectionStatus, true);
        trayService.setConnected(event.server.name, event.server.ping ?? null);
        const connectedAt =
          deps.connectionMonitorService.getStatus().lastConnectionTime ??
          Date.now();
        trafficStatsService.start(connectedAt);
      }
      if (eventName === 'disconnected') {
        sendToRenderer(IPC_EVENT_CHANNELS.connectionStatus, false);
        trayService.setDisconnected();
        trafficStatsService.stop();
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

  registerUpdateHandlers({ assertTrustedSender });
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
