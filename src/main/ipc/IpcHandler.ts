import { ipcMain, IpcMainEvent, IpcMainInvokeEvent, BrowserWindow, app } from 'electron';
import { ConnectionMode, VlessConfig } from '../../shared/types';
import {
  ConnectionMonitorStatus,
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
  IpcEventChannel,
  TunCapabilityStatus,
} from '../../shared/ipc';
import { configService } from '../services/ConfigService';
import { subscriptionService } from '../services/SubscriptionService';
import { logger } from '../services/LoggerService';
import { logExportService } from '../services/LogExportService';
import { connectionMonitorService } from '../services/ConnectionMonitorService';
import { xrayService } from '../services/XrayService';
import { createIpcDependencies, IpcDependencies } from './dependencies';
import { registerConnectionHandlers } from './handlers/connectionHandlers';
import { registerPingHandlers } from './handlers/pingHandlers';
import { assertBoolean, assertConnectionMode, normalizeSavePayload, redactUrl } from './validators';

let windowRef: BrowserWindow | null = null;
let handlersRegistered = false;
type RefreshSubscriptionResult = { configCount: number; reason?: string; usedManualFallback?: boolean };
let refreshQueue: Promise<RefreshSubscriptionResult> = Promise.resolve({ configCount: 0 });
let autoRefreshTimer: NodeJS.Timeout | null = null;
const AUTO_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const BACKGROUND_TRANSLATED_FEED_URL =
  'https://translated.turbopages.org/proxy_u/de-de.ru.5a331ed1-69c6e3ed-67d6863b-74722d776562/https/raw.githubusercontent.com/igareck/vpn-configs-for-russia/refs/heads/main/WHITE-CIDR-RU-all.txt';
let connectionBusy = false;
let connectionBusyCounter = 0;

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

function assertTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): void {
  const win = getWindow();
  if (!win || event.sender.id !== win.webContents.id) {
    throw new Error('Blocked IPC request from untrusted sender');
  }
}

function stripRawConfigs(servers: VlessConfig[]): VlessConfig[] {
  return servers.map(({ rawConfig, ...rest }) => rest);
}

function queueRefreshSubscription(
  subscriptionUrl: string,
  manualLinks: string
): Promise<RefreshSubscriptionResult> {
  const job = refreshQueue.then(() => refreshSubscription(subscriptionUrl, manualLinks));
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
  const subscriptionUrl = configService.getSubscriptionUrl();
  const manualLinks = configService.getManualLinksInput();
  const hasInput = !!subscriptionUrl.trim() || !!manualLinks.trim();

  stopAutoRefreshTimer();
  if (!hasInput) {
    logger.info('IPC', 'Auto-refresh timer not started: no subscription input');
    return;
  }

  autoRefreshTimer = setInterval(() => {
    const latestSubscriptionUrl = configService.getSubscriptionUrl();
    const latestManualLinks = configService.getManualLinksInput();
    const hasLatestInput = !!latestSubscriptionUrl.trim() || !!latestManualLinks.trim();

    if (!hasLatestInput) {
      stopAutoRefreshTimer();
      return;
    }

    void queueRefreshSubscription(latestSubscriptionUrl, latestManualLinks)
      .then((result) => {
        if (latestSubscriptionUrl.trim() && (result.usedManualFallback || result.configCount === 0)) {
          reportSubscriptionRefreshIssue(result.reason || 'No valid configuration links were found');
        }
      })
      .catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        reportSubscriptionRefreshIssue(reason);
      });
  }, AUTO_REFRESH_INTERVAL_MS);

  logger.info('IPC', 'Auto-refresh timer started', {
    intervalMs: AUTO_REFRESH_INTERVAL_MS,
    hasSubscriptionUrl: !!subscriptionUrl.trim(),
    hasManualLinks: !!manualLinks.trim(),
    redactedSubscriptionUrl: redactUrl(subscriptionUrl),
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
    await deps.connectionStackService.resetNetworkingStack({ stopXray: true });
    await deps.connectionStackService.applyConnectionMode(fullConfig, 'tun', deps.constants.ports);
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

  ipcMain.handle(IPC_INVOKE_CHANNELS.saveSubscription, async (_event: IpcMainInvokeEvent, payload: unknown) => {
    assertTrustedSender(_event);
    const normalizedPayload = normalizeSavePayload(payload);
    const { subscriptionUrl, manualLinks } = normalizedPayload;
    logger.info('IPC', 'save-subscription', {
      hasSubscriptionUrl: !!subscriptionUrl,
      redactedSubscriptionUrl: redactUrl(subscriptionUrl),
      hasManualLinks: !!manualLinks?.trim(),
    });
    try {
      configService.setSubscriptionUrl(subscriptionUrl || '');
      configService.setManualLinksInput(manualLinks || '');
      const result = await queueRefreshSubscription(subscriptionUrl || '', manualLinks || '');
      const hasInput = !!subscriptionUrl.trim() || !!manualLinks.trim();
      if (subscriptionUrl.trim() && result.usedManualFallback) {
        throw new Error(result.reason || 'Subscription fetch failed; manual fallback was used');
      }
      if (hasInput && result.configCount === 0) {
        throw new Error(result.reason || 'No valid configs found in subscription or manual links');
      }
      restartAutoRefreshTimer();
      return true;
    } catch (e) {
      logger.error('IPC', 'save-subscription failed', e);
      throw e;
    }
  });
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

  ipcMain.handle(IPC_INVOKE_CHANNELS.getServers, (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    return stripRawConfigs(configService.getServers());
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.getSubscriptionUrl, (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    return configService.getSubscriptionUrl();
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.getManualLinks, (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    return configService.getManualLinksInput();
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
    const status = connectionMonitorService.getStatus();
    return {
      ...status,
      autoSwitchingEnabled: connectionMonitorService.getAutoSwitchingEnabled(),
    } as ConnectionMonitorStatus;
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
      sendToRenderer(IPC_EVENT_CHANNELS.connectionMonitorEvent, event);
      if (eventName === 'connected' && event.server) {
        sendToRenderer(IPC_EVENT_CHANNELS.connectionStatus, true);
      }
      if (eventName === 'disconnected') {
        sendToRenderer(IPC_EVENT_CHANNELS.connectionStatus, false);
      }
    });
  }
}

async function refreshSubscription(
  subscriptionUrl: string,
  manualLinks: string
): Promise<RefreshSubscriptionResult> {
  logger.info('IPC', 'refreshSubscription start', {
    hasSubscriptionUrl: !!subscriptionUrl,
    redactedSubscriptionUrl: redactUrl(subscriptionUrl),
    hasManualLinks: !!manualLinks?.trim(),
  });
  try {
    const configs: VlessConfig[] = [];
    let subscriptionExtractedLinks: string[] = [];
    let effectiveManualLinksText = manualLinks.trim();
    let usedManualFallback = false;
    let backgroundFeedErrorMessage = '';

    try {
      const backgroundResult = await subscriptionService.fetchAndParseDetailed(BACKGROUND_TRANSLATED_FEED_URL);
      configs.push(...backgroundResult.configs.map((cfg) => ({ ...cfg, source: 'manual' as const })));
      logger.info('IPC', 'Background translated feed refresh success', {
        count: backgroundResult.configs.length,
        redactedUrl: redactUrl(BACKGROUND_TRANSLATED_FEED_URL),
      });
    } catch (error) {
      backgroundFeedErrorMessage = error instanceof Error ? error.message : String(error);
      logger.warn('IPC', 'Background translated feed refresh failed', {
        redactedUrl: redactUrl(BACKGROUND_TRANSLATED_FEED_URL),
        reason: backgroundFeedErrorMessage,
      });
    }

    let fetchErrorMessage = '';
    if (subscriptionUrl.trim()) {
      try {
        const result = await subscriptionService.fetchAndParseDetailed(subscriptionUrl.trim());
        subscriptionExtractedLinks = result.extractedLinks;
        configs.push(...result.configs.map((cfg) => ({ ...cfg, source: 'subscription' as const })));
        if (subscriptionExtractedLinks.length > 0) {
          // Keep manual links in sync with the latest mirror payload instead of accumulating stale entries.
          effectiveManualLinksText = Array.from(new Set(subscriptionExtractedLinks)).join('\n');
        }
      } catch (error) {
        fetchErrorMessage = error instanceof Error ? error.message : String(error);
        logger.error('IPC', 'Failed to fetch subscription URL, keeping manual configs if present', error);
        if (effectiveManualLinksText.length > 0) {
          usedManualFallback = true;
        }
      }
    }

    if (effectiveManualLinksText) {
      const manualConfigs = subscriptionService.parseDirectLinksFromText(effectiveManualLinksText);
      configs.push(...manualConfigs.map((cfg) => ({ ...cfg, source: 'manual' as const })));
    }

    const uniqueConfigs = Array.from(new Map(configs.map((cfg) => [getDedupKey(cfg), cfg])).values());
    logger.info('IPC', 'refreshSubscription success', { count: uniqueConfigs.length });
    
    const existingServers = configService.getServers();
    const pingDataMap = new Map<string, { ping: number | null; pingTime: number | undefined }>();
    existingServers.forEach(server => {
      if (server.ping !== undefined || server.pingTime !== undefined) {
        const key = server.uuid;
        pingDataMap.set(key, {
          ping: server.ping ?? null,
          pingTime: server.pingTime
        });
      }
    });
    
    const configsWithPing = uniqueConfigs.map(config => {
      const key = config.uuid;
      const pingData = pingDataMap.get(key);
      if (pingData) {
        return { ...config, ping: pingData.ping, pingTime: pingData.pingTime };
      }
      // Keep ping shape stable in renderer: use null instead of undefined.
      return { ...config, ping: null };
    });
    
    const hasInput = !!subscriptionUrl.trim() || !!manualLinks.trim();
    if (configsWithPing.length === 0 && hasInput) {
      return {
        configCount: 0,
        usedManualFallback,
        reason: fetchErrorMessage || backgroundFeedErrorMessage || 'No valid configuration links were found',
      };
    }

    if (subscriptionExtractedLinks.length > 0) {
      configService.setManualLinksInput(effectiveManualLinksText);
      sendToRenderer(IPC_EVENT_CHANNELS.manualLinksUpdated, effectiveManualLinksText);
    }

    configService.setServers(configsWithPing);
    sendToRenderer(IPC_EVENT_CHANNELS.updateServers, stripRawConfigs(configsWithPing));
    if (configsWithPing.length === 0) {
      return {
        configCount: 0,
        usedManualFallback,
        reason: fetchErrorMessage || backgroundFeedErrorMessage || 'No valid configuration links were found',
      };
    }
    return {
      configCount: configsWithPing.length,
      usedManualFallback,
      reason: usedManualFallback ? fetchErrorMessage || 'Subscription fetch failed; manual fallback was used' : undefined,
    };
  } catch (error) {
    logger.error('IPC', 'Failed to update subscription', error);
    return {
      configCount: 0,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function loadInitialState(window: BrowserWindow) {
  windowRef = window;
  const deps = createIpcDependencies();
  logger.info('IPC', 'loadInitialState called');
  const url = configService.getSubscriptionUrl();
  const manualLinks = configService.getManualLinksInput();
  const pendingTunReconnectServerId = configService.consumePendingTunReconnect();
  logger.info('IPC', 'loadInitialState', {
    hasUrl: !!url,
    redactedUrl: redactUrl(url),
    hasManualLinks: !!manualLinks,
    hasPendingTunReconnect: !!pendingTunReconnectServerId,
  });
  
  const savedServers = configService.getServers();
  sendToRenderer(IPC_EVENT_CHANNELS.updateServers, stripRawConfigs(savedServers));

  let pendingTunReconnectJob: Promise<boolean> | null = null;
  if (pendingTunReconnectServerId) {
    // First attempt immediately using saved servers to minimize downtime.
    pendingTunReconnectJob = attemptPendingTunReconnect(pendingTunReconnectServerId, deps, {
      emitErrorOnFailure: !(url || manualLinks),
    });
  }

  if (url || manualLinks) {
    // Do not await: subscription fetch can take a long time; UI already has saved servers.
    const refreshJob = queueRefreshSubscription(url, manualLinks);
    void refreshJob
      .then((result) => {
        if (url.trim() && (result.usedManualFallback || result.configCount === 0)) {
          reportSubscriptionRefreshIssue(result.reason || 'No valid configuration links were found');
        }
      })
      .catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        reportSubscriptionRefreshIssue(reason);
      });
    if (pendingTunReconnectServerId) {
      // Retry after refresh only if the first attempt did not establish connection.
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
      })
        .catch((error) => {
          logger.error('IPC', 'Pending TUN reconnect retry after refresh failed', error);
        });
    }
    restartAutoRefreshTimer();
  } else {
    logger.info('IPC', 'No subscription URL or manual links saved');
    stopAutoRefreshTimer();
  }
}
