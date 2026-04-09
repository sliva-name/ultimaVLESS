import { ipcMain, IpcMainEvent, IpcMainInvokeEvent, BrowserWindow, app, shell } from 'electron';
import { ConnectionMode, VlessConfig } from '../../shared/types';
import {
  AddSubscriptionResult,
  ConnectionMonitorStatus,
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
  IpcEventChannel,
  SaveManualLinksResult,
  TunCapabilityStatus,
} from '../../shared/ipc';
import { YANDEX_TRANSLATED_MOBILE_LIST_URL } from '../../shared/subscriptionUrls';
import { configService } from '../services/ConfigService';
import { subscriptionService } from '../services/SubscriptionService';
import { logger } from '../services/LoggerService';
import { logExportService } from '../services/LogExportService';
import { connectionMonitorService } from '../services/ConnectionMonitorService';
import { xrayService } from '../services/XrayService';
import { appRecoveryService } from '../services/AppRecoveryService';
import { createIpcDependencies, IpcDependencies } from './dependencies';
import { registerConnectionHandlers } from './handlers/connectionHandlers';
import { registerPingHandlers } from './handlers/pingHandlers';
import { buildConnectionMonitorStatusSummary } from './connectionStatusSummary';
import { preserveActiveServerIfNeeded } from './refreshUtils';
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
type RefreshSubscriptionResult = { configCount: number; reason?: string; partialErrors?: string[] };
let refreshQueue: Promise<RefreshSubscriptionResult> = Promise.resolve({ configCount: 0 });
let autoRefreshTimer: NodeJS.Timeout | null = null;
const AUTO_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
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

function reportSubscriptionRefreshIssue(reason: string): void {
  const message = `Subscription update failed: ${reason}`;
  logger.warn('IPC', message);
  sendToRenderer(IPC_EVENT_CHANNELS.connectionError, message);
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

function stripRawConfigs(servers: VlessConfig[]): VlessConfig[] {
  return servers.map(({ rawConfig: _rawConfig, ...rest }) => rest);
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

function queueRefreshAllSubscriptions(
  manualLinks: string
): Promise<RefreshSubscriptionResult> {
  const job = refreshQueue.then(() => refreshAllSubscriptions(manualLinks));
  refreshQueue = job.catch(() => ({ configCount: 0 }));
  return job;
}

function stopAutoRefreshTimer(): void {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
    logger.info('IPC', 'Auto-refresh timer stopped');
  }
}

function restartAutoRefreshTimer(): void {
  const subscriptions = configService.getSubscriptions();
  const manualLinks = configService.getManualLinksInput();
  const hasInput = subscriptions.some((s) => s.enabled) || !!manualLinks.trim();

  stopAutoRefreshTimer();
  if (!hasInput) {
    logger.info('IPC', 'Auto-refresh timer not started: no subscription input');
    return;
  }

  autoRefreshTimer = setInterval(() => {
    const latestManualLinks = configService.getManualLinksInput();
    const latestSubs = configService.getSubscriptions();
    const hasLatestInput = latestSubs.some((s) => s.enabled) || !!latestManualLinks.trim();

    if (!hasLatestInput) {
      stopAutoRefreshTimer();
      return;
    }

    void queueRefreshAllSubscriptions(latestManualLinks)
      .then((result) => {
        if (result.configCount === 0) {
          reportSubscriptionRefreshIssue(result.reason || 'No valid configuration links were found');
        } else if (result.partialErrors && result.partialErrors.length > 0) {
          logger.warn('IPC', 'Some subscriptions failed during auto-refresh', {
            errors: result.partialErrors,
          });
        }
      })
      .catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        reportSubscriptionRefreshIssue(reason);
      });
  }, AUTO_REFRESH_INTERVAL_MS);

  logger.info('IPC', 'Auto-refresh timer started', {
    intervalMs: AUTO_REFRESH_INTERVAL_MS,
    subscriptionCount: subscriptions.filter((s) => s.enabled).length,
    hasManualLinks: !!manualLinks.trim(),
  });
}

function getDedupKey(config: VlessConfig): string {
  return [
    config.uuid || '',
    config.address || '',
    String(config.port || 0),
    config.type || '',
    config.security || '',
    config.sni || '',
    config.fp || '',
    config.pbk || '',
    config.sid || '',
    config.spx || '',
    config.path || '',
    config.host || '',
    config.serviceName || '',
    config.flow || '',
    config.encryption || '',
  ].join('|');
}

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

  const handleAsync = async (operation: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      logger.error('IPC', `Operation failed: ${operation}`, error);
    }
  };

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
      sendToRenderer(IPC_EVENT_CHANNELS.updateServers, stripRawConfigs(without));
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
    sendToRenderer(IPC_EVENT_CHANNELS.updateServers, stripRawConfigs(without));

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
    handleAsync,
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
    return stripRawConfigs(configService.getServers());
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
    return xrayService.isRunning();
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.getConnectionBusy, (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    return connectionBusy;
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.getAppVersion, (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    return app.getVersion();
  });

  registerPingHandlers({ deps, sendToRenderer, stripRawConfigs, assertTrustedSender });

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
// Core refresh logic
// ---------------------------------------------------------------------------

async function refreshAllSubscriptions(
  manualLinks: string
): Promise<RefreshSubscriptionResult> {
  const subscriptions = configService.getSubscriptions();
  const enabled = subscriptions.filter((s) => s.enabled);

  logger.info('IPC', 'refreshAllSubscriptions start', {
    enabledCount: enabled.length,
    hasManualLinks: !!manualLinks?.trim(),
  });

  const configs: VlessConfig[] = [];
  const partialErrors: string[] = [];
  const failedSubscriptionIds = new Set<string>();

  for (const sub of enabled) {
    try {
      const result = await subscriptionService.fetchAndParseDetailed(sub.url.trim());
      configs.push(
        ...result.configs.map((cfg) => ({
          ...cfg,
          source: 'subscription' as const,
          subscriptionId: sub.id,
        }))
      );
      logger.info('IPC', `Fetched subscription "${sub.name}"`, {
        count: result.configs.length,
        redactedUrl: redactUrl(sub.url),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      partialErrors.push(`${sub.name}: ${msg}`);
      failedSubscriptionIds.add(sub.id);
      logger.error('IPC', `Failed to fetch subscription "${sub.name}"`, error);
    }
  }

  const effectiveManualLinksText = manualLinks.trim();
  if (effectiveManualLinksText) {
    const manualConfigs = subscriptionService.parseDirectLinksFromText(effectiveManualLinksText);
    configs.push(...manualConfigs.map((cfg) => ({ ...cfg, source: 'manual' as const })));
  }

  const uniqueConfigs = Array.from(new Map(configs.map((cfg) => [getDedupKey(cfg), cfg])).values());
  logger.info('IPC', 'refreshAllSubscriptions dedup', { total: uniqueConfigs.length });

  const existingServers = configService.getServers();

  // When some subscriptions fail to fetch, preserve their existing servers so they don't
  // disappear from the list just because of a temporary network error.
  let mergedConfigs = uniqueConfigs;
  if (failedSubscriptionIds.size > 0) {
    const freshKeys = new Set(uniqueConfigs.map(getDedupKey));
    const preservedFromFailed = existingServers.filter(
      (s) => s.subscriptionId && failedSubscriptionIds.has(s.subscriptionId) && !freshKeys.has(getDedupKey(s))
    );
    if (preservedFromFailed.length > 0) {
      logger.warn('IPC', 'Preserving servers from failed subscriptions to prevent data loss', {
        preserved: preservedFromFailed.length,
        failedCount: failedSubscriptionIds.size,
      });
      mergedConfigs = [...uniqueConfigs, ...preservedFromFailed];
    }
  }

  const pingDataMap = new Map<string, { ping: number | null; pingTime: number | undefined }>();
  existingServers.forEach((server) => {
    if (server.ping !== undefined || server.pingTime !== undefined) {
      pingDataMap.set(server.uuid, {
        ping: server.ping ?? null,
        pingTime: server.pingTime,
      });
    }
  });

  const configsWithPing = mergedConfigs.map((config) => {
    const pingData = pingDataMap.get(config.uuid);
    if (pingData) {
      return { ...config, ping: pingData.ping, pingTime: pingData.pingTime };
    }
    return { ...config, ping: null };
  });

  const monitorStatus = connectionMonitorService.getStatus();
  const effectiveConfigs = preserveActiveServerIfNeeded(
    configsWithPing,
    existingServers,
    monitorStatus,
    xrayService.isRunning()
  );
  if (effectiveConfigs.length !== configsWithPing.length && monitorStatus.currentServer) {
    logger.warn('IPC', 'Preserving active server during background refresh', {
      serverId: monitorStatus.currentServer.uuid.substring(0, 8),
      serverName: monitorStatus.currentServer.name,
    });
  }

  const hasInput = enabled.length > 0 || !!manualLinks.trim();
  if (effectiveConfigs.length === 0 && hasInput) {
    return {
      configCount: 0,
      partialErrors,
      reason: partialErrors.length > 0
        ? partialErrors.join('; ')
        : 'No valid configuration links were found',
    };
  }

  configService.setServers(effectiveConfigs);
  const syncedCurrentServer = connectionMonitorService.syncCurrentServer(effectiveConfigs);
  if (syncedCurrentServer) {
    configService.setSelectedServerId(syncedCurrentServer.uuid);
  }
  sendToRenderer(IPC_EVENT_CHANNELS.updateServers, stripRawConfigs(effectiveConfigs));

  return {
    configCount: effectiveConfigs.length,
    partialErrors,
  };
}

// ---------------------------------------------------------------------------
// Initial state loader
// ---------------------------------------------------------------------------

export async function loadInitialState(window: BrowserWindow) {
  windowRef = window;
  const deps = createIpcDependencies();
  logger.info('IPC', 'loadInitialState called');

  const subscriptions = configService.getSubscriptions();
  const manualLinks = configService.getManualLinksInput();
  const pendingTunReconnectServerId = configService.consumePendingTunReconnect();

  logger.info('IPC', 'loadInitialState', {
    subscriptionCount: subscriptions.length,
    enabledCount: subscriptions.filter((s) => s.enabled).length,
    hasManualLinks: !!manualLinks,
    hasPendingTunReconnect: !!pendingTunReconnectServerId,
  });

  const savedServers = configService.getServers();
  sendToRenderer(IPC_EVENT_CHANNELS.updateServers, stripRawConfigs(savedServers));
  sendToRenderer(IPC_EVENT_CHANNELS.updateSubscriptions, subscriptions);

  let pendingTunReconnectJob: Promise<boolean> | null = null;
  if (pendingTunReconnectServerId) {
    pendingTunReconnectJob = attemptPendingTunReconnect(pendingTunReconnectServerId, deps, {
      emitErrorOnFailure: !(subscriptions.some((s) => s.enabled) || manualLinks),
    });
  }

  const hasInput = subscriptions.some((s) => s.enabled) || !!manualLinks.trim();
  if (hasInput) {
    const refreshJob = queueRefreshAllSubscriptions(manualLinks);
    void refreshJob
      .then((result) => {
        if (result.configCount === 0) {
          reportSubscriptionRefreshIssue(result.reason || 'No valid configuration links were found');
        } else if (result.partialErrors && result.partialErrors.length > 0) {
          logger.warn('IPC', 'Some subscriptions failed on initial load', {
            errors: result.partialErrors,
          });
        }
      })
      .catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        reportSubscriptionRefreshIssue(reason);
      });

    if (pendingTunReconnectServerId) {
      void refreshJob.then(async () => {
        if (pendingTunReconnectJob) {
          try {
            await pendingTunReconnectJob;
          } catch {
            // attemptPendingTunReconnect already logs and handles errors
          }
        }
        const monitorStatus = deps.connectionMonitorService.getStatus();
        const alreadyConnected =
          deps.xrayService.isRunning() &&
          monitorStatus.isConnected &&
          monitorStatus.currentServer?.uuid === pendingTunReconnectServerId;
        if (alreadyConnected) {
          logger.info('IPC', 'Skipping pending TUN reconnect retry: already connected', {
            serverId: pendingTunReconnectServerId.substring(0, 8),
          });
          return;
        }
        return attemptPendingTunReconnect(pendingTunReconnectServerId, deps, { emitErrorOnFailure: true });
      }).catch((error) => {
        logger.error('IPC', 'Pending TUN reconnect retry after refresh failed', error);
      });
    }
    restartAutoRefreshTimer();
  } else {
    logger.info('IPC', 'No enabled subscriptions or manual links saved');
    stopAutoRefreshTimer();
  }
}
