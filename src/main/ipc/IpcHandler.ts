import { ipcMain, IpcMainEvent, IpcMainInvokeEvent, BrowserWindow, app, shell } from 'electron';
import { ConnectionMode, VlessConfig } from '@/shared/types';
import {
  AddSubscriptionResult,
  ConnectionMonitorStatus,
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
  IpcEventChannel,
  SaveManualLinksResult,
  TunCapabilityStatus,
} from '@/shared/ipc';
import { normalizePerformanceSettings } from '@/shared/performanceSettings';
import { toSafeServerList } from '@/shared/serverView';
import { YANDEX_TRANSLATED_MOBILE_LIST_URL } from '@/shared/subscriptionUrls';
import { configService } from '@/main/services/ConfigService';
import { subscriptionService } from '@/main/services/SubscriptionService';
import { logger } from '@/main/services/LoggerService';
import { logExportService } from '@/main/services/LogExportService';
import { connectionMonitorService } from '@/main/services/ConnectionMonitorService';
import { xrayService } from '@/main/services/XrayService';
import { appRecoveryService } from '@/main/services/AppRecoveryService';
import { createIpcDependencies, IpcDependencies } from './dependencies';
import { registerConnectionHandlers } from './handlers/connectionHandlers';
import { registerPingHandlers } from './handlers/pingHandlers';
import { buildConnectionMonitorStatusSummary } from './connectionStatusSummary';
import { createSubscriptionRefreshManager } from './subscriptionRefresh';
import { loadInitialState as loadInitialStateRuntime } from './initialState';
import {
  assertBoolean,
  assertConnectionMode,
  normalizeAddSubscriptionPayload,
  normalizeManualLinks,
  normalizeUpdateSubscriptionPayload,
  redactUrl,
} from './validators';

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
  deps: IpcDependencies
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
      logger.error('IPC', 'Failed to recover after unexpected Xray exit', error);
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
    connectionMonitorService: Pick<typeof connectionMonitorService, 'getStatus' | 'getAutoSwitchingEnabled'>;
    xrayService: Pick<typeof xrayService, 'getHealthStatus'>;
    appRecoveryService: Pick<typeof appRecoveryService, 'getStatus'>;
  } = {
    connectionMonitorService,
    xrayService,
    appRecoveryService,
  }
): ConnectionMonitorStatus {
  const status = deps.connectionMonitorService.getStatus();
  return buildConnectionMonitorStatusSummary(
    status,
    deps.connectionMonitorService.getAutoSwitchingEnabled(),
    deps.xrayService.getHealthStatus(),
    deps.appRecoveryService.getStatus()
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
  options: { emitErrorOnFailure: boolean } = { emitErrorOnFailure: true }
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

    const fullConfig = deps.configService.getServers().find((s) => s.uuid === serverId);
    if (!fullConfig) {
      logger.warn('IPC', 'Pending TUN reconnect server not found in local configuration', {
        serverId: serverIdPreview,
      });
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
      throw new Error(deps.tunRouteService.getUnsupportedReason() || 'TUN mode is not supported on this operating system.');
    }

    if (!(await deps.hasTunPrivileges())) {
      throw new Error('Pending TUN reconnect requires elevated privileges');
    }

    logger.info('IPC', 'Applying pending TUN reconnect', {
      serverId: serverIdPreview,
      serverName: fullConfig.name,
    });
    await deps.connectionStackService.transitionTo(fullConfig, 'tun', deps.constants.ports, {
      stopXray: true,
    });
    deps.configService.setSelectedServerId(fullConfig.uuid);
    deps.connectionMonitorService.startMonitoring(fullConfig);
    return true;
  } catch (error) {
    logger.error('IPC', 'Pending TUN reconnect failed', error);
    try {
      await deps.connectionStackService.cleanupAfterFailure();
    } catch (cleanupError) {
      logger.error('IPC', 'Failed to cleanup network stack after pending reconnect failure', cleanupError);
    }

    if (emitErrorOnFailure) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      deps.connectionMonitorService.recordError(errorMessage);
      sendToRenderer(IPC_EVENT_CHANNELS.connectionError, `Auto-connect failed: ${errorMessage}`);
    }
    return false;
  } finally {
    endConnectionBusy();
  }
}

export function registerIpcHandlers(
  mainWindow: BrowserWindow,
  deps: IpcDependencies = createIpcDependencies()
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

  // -------------------------------------------------------------------------
  // Subscriptions CRUD
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC_INVOKE_CHANNELS.getSubscriptions, (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    return configService.getSubscriptions();
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.addSubscription, async (event: IpcMainInvokeEvent, payload: unknown) => {
    assertTrustedSender(event);
    const { name, url } = normalizeAddSubscriptionPayload(payload);
    logger.info('IPC', 'add-subscription', { name, redactedUrl: redactUrl(url) });

    const sub = configService.addSubscription({ name, url, enabled: true });
    sendToRenderer(IPC_EVENT_CHANNELS.updateSubscriptions, configService.getSubscriptions());

    const manualLinks = configService.getManualLinksInput();
    const result = await queueRefreshAllSubscriptions(manualLinks);
    restartAutoRefreshTimer();

    if (result.configCount === 0) {
      return {
        ok: false,
        configCount: 0,
        error: result.reason || 'No valid configuration links were found in the subscription',
        subscriptionId: sub.id,
      } as AddSubscriptionResult & { subscriptionId: string };
    }
    return { ok: true, configCount: result.configCount, subscriptionId: sub.id } as AddSubscriptionResult & { subscriptionId: string };
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.updateSubscription, async (event: IpcMainInvokeEvent, payload: unknown) => {
    assertTrustedSender(event);
    const { id, patch } = normalizeUpdateSubscriptionPayload(payload);
    logger.info('IPC', 'update-subscription', { id });

    const updated = configService.updateSubscription(id, patch);
    if (!updated) {
      throw new Error(`Subscription not found: ${id}`);
    }
    sendToRenderer(IPC_EVENT_CHANNELS.updateSubscriptions, configService.getSubscriptions());

    // Re-fetch if URL or enabled state changed.
    if (patch.url !== undefined || patch.enabled === true) {
      const manualLinks = configService.getManualLinksInput();
      await queueRefreshAllSubscriptions(manualLinks);
      restartAutoRefreshTimer();
    } else if (patch.enabled === false) {
      // Remove this subscription's servers from the list.
      const existing = configService.getServers();
      const without = existing.filter((s) => s.subscriptionId !== id);
      configService.setServers(without);
      sendToRenderer(IPC_EVENT_CHANNELS.updateServers, toSafeServerList(without));
      restartAutoRefreshTimer();
    }

    return true;
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.deleteSubscription, async (event: IpcMainInvokeEvent, payload: unknown) => {
    assertTrustedSender(event);
    if (!payload || typeof payload !== 'object') throw new Error('Invalid payload');
    const id = (payload as Record<string, unknown>).id;
    if (typeof id !== 'string' || !id.trim()) throw new Error('Subscription id is required');

    logger.info('IPC', 'delete-subscription', { id });
    configService.removeSubscription(id);
    sendToRenderer(IPC_EVENT_CHANNELS.updateSubscriptions, configService.getSubscriptions());

    // Remove all servers that belonged to this subscription.
    const existing = configService.getServers();
    const without = existing.filter((s) => s.subscriptionId !== id);
    configService.setServers(without);
    sendToRenderer(IPC_EVENT_CHANNELS.updateServers, toSafeServerList(without));

    restartAutoRefreshTimer();
    return true;
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.refreshSubscriptions, async (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    logger.info('IPC', 'refresh-subscriptions');
    const manualLinks = configService.getManualLinksInput();
    const result = await queueRefreshAllSubscriptions(manualLinks);
    return { ok: result.configCount > 0, configCount: result.configCount, error: result.reason };
  });

  // -------------------------------------------------------------------------
  // Mobile Whitelist — now *adds* a subscription instead of replacing
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC_INVOKE_CHANNELS.importMobileWhiteListSubscription, async (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    const existing = configService.getSubscriptions();
    const alreadyExists = existing.find((s) => s.url === YANDEX_TRANSLATED_MOBILE_LIST_URL);
    if (!alreadyExists) {
      configService.addSubscription({
        name: 'Mobile Whitelist',
        url: YANDEX_TRANSLATED_MOBILE_LIST_URL,
        enabled: true,
      });
      sendToRenderer(IPC_EVENT_CHANNELS.updateSubscriptions, configService.getSubscriptions());
    }

    const manualLinks = configService.getManualLinksInput();
    const result = await queueRefreshAllSubscriptions(manualLinks);
    restartAutoRefreshTimer();

    if (result.configCount === 0) {
      return {
        ok: false,
        configCount: 0,
        error: result.reason || 'No valid configuration links were found',
      };
    }
    return { ok: true, configCount: result.configCount };
  });

  // -------------------------------------------------------------------------
  // Manual links
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC_INVOKE_CHANNELS.saveManualLinks, async (event: IpcMainInvokeEvent, payload: unknown) => {
    assertTrustedSender(event);
    const manualLinks = normalizeManualLinks(payload);
    logger.info('IPC', 'save-manual-links', { hasManualLinks: !!manualLinks.trim() });

    configService.setManualLinksInput(manualLinks);
    const result = await queueRefreshAllSubscriptions(manualLinks);
    restartAutoRefreshTimer();

    if (result.configCount === 0 && !!manualLinks.trim()) {
      return {
        ok: false,
        configCount: 0,
        error: result.reason || 'No valid configs found in manual links',
      } as SaveManualLinksResult;
    }
    return { ok: true, configCount: result.configCount } as SaveManualLinksResult;
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.getManualLinks, (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    return configService.getManualLinksInput();
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

  ipcMain.handle(IPC_INVOKE_CHANNELS.getLogs, async (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    try {
      return await logExportService.getExportableLogs();
    } catch (e) {
      logger.error('IPC', 'get-logs failed', e);
      return '';
    }
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.openLogFolder, async (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    await logExportService.openLogFolder();
    return true;
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.openExternalUrl, async (event: IpcMainInvokeEvent, url: unknown) => {
    assertTrustedSender(event);
    if (typeof url !== 'string' || url.length === 0) {
      throw new Error('Invalid URL');
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Invalid URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only http(s) URLs are allowed');
    }
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.getServers, (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    return toSafeServerList(configService.getServers());
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.getSelectedServerId, (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    return configService.getSelectedServerId();
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.setSelectedServerId, (event: IpcMainInvokeEvent, serverId: unknown) => {
    assertTrustedSender(event);
    if (typeof serverId !== 'string' && serverId !== null) {
      throw new Error('Invalid selected server id');
    }
    if (typeof serverId === 'string' && serverId.trim().length === 0) {
      configService.setSelectedServerId(null);
      return true;
    }
    configService.setSelectedServerId(serverId);
    return true;
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.getConnectionMode, (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    return configService.getConnectionMode();
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.getTunCapabilityStatus, async (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    const supported = deps.tunRouteService.isSupported();
    const hasPrivileges = supported ? await deps.hasTunPrivileges() : false;
    const privilegeHint =
      process.platform === 'win32'
        ? 'TUN mode needs Administrator rights. Connect in TUN mode and approve the UAC prompt (or run UltimaVLESS as Administrator).'
        : 'Run UltimaVLESS with root privileges for TUN mode.';
    const result: TunCapabilityStatus = {
      platform: process.platform,
      supported,
      hasPrivileges,
      privilegeHint: supported && !hasPrivileges ? privilegeHint : null,
      unsupportedReason: supported ? null : deps.tunRouteService.getUnsupportedReason(),
      routeMode: supported ? deps.tunRouteService.getRouteMode() : null,
      degradedReason: supported ? deps.tunRouteService.getDegradedReason() : null,
    };
    return result;
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.setConnectionMode, (_event: IpcMainInvokeEvent, modeValue: unknown) => {
    assertTrustedSender(_event);
    const mode: ConnectionMode = assertConnectionMode(modeValue);
    if (mode === 'tun' && !deps.tunRouteService.isSupported()) {
      throw new Error(deps.tunRouteService.getUnsupportedReason() || 'TUN mode is not supported on this operating system.');
    }
    if (xrayService.isRunning()) {
      throw new Error('Disconnect before changing connection mode.');
    }
    configService.setConnectionMode(mode);
    return true;
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.getConnectionStatus, (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    return deps.connectionMonitorService.getStatus().isConnected;
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.getConnectionBusy, (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    return connectionBusy;
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.getAppVersion, (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    return app.getVersion();
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.getPerformanceSettings, (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    return configService.getPerformanceSettings();
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.setPerformanceSettings, (_event: IpcMainInvokeEvent, payload: unknown) => {
    assertTrustedSender(_event);
    const settings = normalizePerformanceSettings(payload);
    configService.setPerformanceSettings(settings);
    return true;
  });

  registerPingHandlers({ deps, sendToRenderer, toSafeServerList, assertTrustedSender, isConnectionBusy: () => connectionBusy });

  ipcMain.handle(IPC_INVOKE_CHANNELS.getConnectionMonitorStatus, (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    return buildConnectionMonitorStatus({
      connectionMonitorService: deps.connectionMonitorService,
      xrayService: deps.xrayService,
      appRecoveryService,
    });
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.setAutoSwitching, (_event: IpcMainInvokeEvent, enabledValue: unknown) => {
    assertTrustedSender(_event);
    const enabled = assertBoolean(enabledValue, 'auto switching value');
    connectionMonitorService.setAutoSwitchingEnabled(enabled);
    return true;
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.clearBlockedServers, (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    connectionMonitorService.clearBlockedServers();
    return true;
  });

  const monitorEvents = ['connected', 'disconnected', 'error', 'blocked', 'switching'] as const;
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
      }
      if (eventName === 'disconnected') {
        sendToRenderer(IPC_EVENT_CHANNELS.connectionStatus, false);
      }
    });
  }
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
    }
  );
}
