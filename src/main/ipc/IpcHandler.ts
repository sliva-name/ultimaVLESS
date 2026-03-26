import { ipcMain, IpcMainEvent, IpcMainInvokeEvent, BrowserWindow, app } from 'electron';
import { ConnectionMode, VlessConfig } from '../../shared/types';
import { configService } from '../services/ConfigService';
import { subscriptionService } from '../services/SubscriptionService';
import { logger } from '../services/LoggerService';
import { logExportService } from '../services/LogExportService';
import { connectionMonitorService } from '../services/ConnectionMonitorService';
import { xrayService } from '../services/XrayService';
import { createIpcDependencies, IpcDependencies } from './dependencies';
import { registerConnectionHandlers } from './handlers/connectionHandlers';
import { registerPingHandlers } from './handlers/pingHandlers';
import { assertBoolean, normalizeSavePayload, redactUrl } from './validators';

let windowRef: BrowserWindow | null = null;
let handlersRegistered = false;
let refreshQueue: Promise<{ configCount: number; reason?: string }> = Promise.resolve({ configCount: 0 });

function getWindow(): BrowserWindow | null {
  if (windowRef && !windowRef.isDestroyed()) return windowRef;
  return null;
}

function sendToRenderer(channel: string, ...args: unknown[]) {
  const win = getWindow();
  if (win) {
    win.webContents.send(channel, ...args);
  }
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
): Promise<{ configCount: number; reason?: string }> {
  const job = refreshQueue.then(() => refreshSubscription(subscriptionUrl, manualLinks));
  refreshQueue = job.catch(() => ({ configCount: 0 }));
  return job;
}

function getDedupKey(config: VlessConfig): string {
  return [
    config.source || '',
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

  ipcMain.handle('save-subscription', async (_event: IpcMainInvokeEvent, payload: unknown) => {
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
      if (hasInput && result.configCount === 0) {
        throw new Error(result.reason || 'No valid configs found in subscription or manual links');
      }
      return true;
    } catch (e) {
      logger.error('IPC', 'save-subscription failed', e);
      throw e;
    }
  });
  registerConnectionHandlers({ deps, handleAsync, assertTrustedSender, sendToRenderer });

  ipcMain.handle('get-logs', async (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    try {
      return await logExportService.getExportableLogs();
    } catch (e) {
      logger.error('IPC', 'get-logs failed', e);
      return '';
    }
  });

  ipcMain.handle('open-log-folder', async (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    await logExportService.openLogFolder();
    return true;
  });

  ipcMain.handle('get-servers', (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    return stripRawConfigs(configService.getServers());
  });

  ipcMain.handle('get-subscription-url', (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    return configService.getSubscriptionUrl();
  });

  ipcMain.handle('get-manual-links', (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    return configService.getManualLinksInput();
  });

  ipcMain.handle('get-selected-server-id', (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    return configService.getSelectedServerId();
  });

  ipcMain.handle('set-selected-server-id', (event: IpcMainInvokeEvent, serverId: unknown) => {
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

  ipcMain.handle('get-connection-mode', (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    return configService.getConnectionMode();
  });

  ipcMain.handle('set-connection-mode', (_event: IpcMainInvokeEvent, mode: ConnectionMode) => {
    assertTrustedSender(_event);
    if (mode !== 'proxy' && mode !== 'tun') {
      throw new Error('Invalid connection mode');
    }
    if (xrayService.isRunning()) {
      throw new Error('Disconnect before changing connection mode.');
    }
    configService.setConnectionMode(mode);
    return true;
  });

  ipcMain.handle('get-connection-status', (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    return xrayService.isRunning();
  });

  ipcMain.handle('get-app-version', (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    return app.getVersion();
  });

  registerPingHandlers({ deps, sendToRenderer, stripRawConfigs, assertTrustedSender });

  ipcMain.handle('get-connection-monitor-status', (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    const status = connectionMonitorService.getStatus();
    return {
      ...status,
      autoSwitchingEnabled: connectionMonitorService.getAutoSwitchingEnabled(),
    };
  });

  ipcMain.handle('set-auto-switching', (_event: IpcMainInvokeEvent, enabledValue: unknown) => {
    assertTrustedSender(_event);
    const enabled = assertBoolean(enabledValue, 'auto switching value');
    connectionMonitorService.setAutoSwitchingEnabled(enabled);
    return true;
  });

  ipcMain.handle('clear-blocked-servers', (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    connectionMonitorService.clearBlockedServers();
    return true;
  });

  const monitorEvents = ['connected', 'disconnected', 'error', 'blocked', 'switching'] as const;
  for (const eventName of monitorEvents) {
    connectionMonitorService.on(eventName, (event) => {
      sendToRenderer('connection-monitor-event', event);
      if (eventName === 'connected' && event.server) {
        sendToRenderer('connection-status', true);
      }
      if (eventName === 'disconnected') {
        sendToRenderer('connection-status', false);
      }
    });
  }
}

async function refreshSubscription(
  subscriptionUrl: string,
  manualLinks: string
): Promise<{ configCount: number; reason?: string }> {
  logger.info('IPC', 'refreshSubscription start', {
    hasSubscriptionUrl: !!subscriptionUrl,
    redactedSubscriptionUrl: redactUrl(subscriptionUrl),
    hasManualLinks: !!manualLinks?.trim(),
  });
  try {
    const configs: VlessConfig[] = [];

    let fetchErrorMessage = '';
    if (subscriptionUrl.trim()) {
      try {
        const subscriptionConfigs = await subscriptionService.fetchAndParse(subscriptionUrl.trim());
        configs.push(...subscriptionConfigs.map((cfg) => ({ ...cfg, source: 'subscription' as const })));
      } catch (error) {
        fetchErrorMessage = error instanceof Error ? error.message : String(error);
        logger.error('IPC', 'Failed to fetch subscription URL, keeping manual configs if present', error);
      }
    }

    if (manualLinks.trim()) {
      const manualConfigs = subscriptionService.parseDirectLinksFromText(manualLinks.trim());
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
        reason: fetchErrorMessage || 'No valid configuration links were found',
      };
    }

    configService.setServers(configsWithPing);
    sendToRenderer('update-servers', stripRawConfigs(configsWithPing));
    if (configsWithPing.length === 0) {
      return {
        configCount: 0,
        reason: fetchErrorMessage || 'No valid configuration links were found',
      };
    }
    return { configCount: configsWithPing.length };
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
  logger.info('IPC', 'loadInitialState called');
  const url = configService.getSubscriptionUrl();
  const manualLinks = configService.getManualLinksInput();
  logger.info('IPC', 'loadInitialState', {
    hasUrl: !!url,
    redactedUrl: redactUrl(url),
    hasManualLinks: !!manualLinks,
  });
  
  const savedServers = configService.getServers();
  sendToRenderer('update-servers', stripRawConfigs(savedServers));

  if (url || manualLinks) {
    // Do not await: subscription fetch can take a long time; UI already has saved servers.
    void queueRefreshSubscription(url, manualLinks).catch((error) => {
      logger.error('IPC', 'Background refreshSubscription failed', error);
    });
  } else {
    logger.info('IPC', 'No subscription URL or manual links saved');
  }
}
