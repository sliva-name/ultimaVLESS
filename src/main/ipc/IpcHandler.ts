import { ipcMain, IpcMainInvokeEvent, BrowserWindow, app } from 'electron';
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

function stripRawConfigs(servers: VlessConfig[]): VlessConfig[] {
  return servers.map(({ rawConfig, ...rest }) => rest);
}

export function registerIpcHandlers(
  mainWindow: BrowserWindow,
  deps: IpcDependencies = createIpcDependencies()
) {
  windowRef = mainWindow;

  const handleAsync = async (operation: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      logger.error('IPC', `Operation failed: ${operation}`, error);
    }
  };

  ipcMain.handle('save-subscription', async (_event: IpcMainInvokeEvent, payload: unknown) => {
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
      const result = await refreshSubscription(subscriptionUrl || '', manualLinks || '');
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
  registerConnectionHandlers({ deps, handleAsync });

  ipcMain.handle('get-logs', async () => {
    try {
      return await logExportService.getExportableLogs();
    } catch (e) {
      logger.error('IPC', 'get-logs failed', e);
      return '';
    }
  });

  ipcMain.on('open-log-folder', () => {
    logExportService.openLogFolder();
  });

  ipcMain.handle('get-servers', () => {
    return stripRawConfigs(configService.getServers());
  });

  ipcMain.handle('get-subscription-url', () => {
    return configService.getSubscriptionUrl();
  });

  ipcMain.handle('get-manual-links', () => {
    return configService.getManualLinksInput();
  });

  ipcMain.handle('get-selected-server-id', () => {
    return configService.getSelectedServerId();
  });

  ipcMain.handle('get-connection-mode', () => {
    return configService.getConnectionMode();
  });

  ipcMain.handle('set-connection-mode', (_event: IpcMainInvokeEvent, mode: ConnectionMode) => {
    if (mode !== 'proxy' && mode !== 'tun') {
      throw new Error('Invalid connection mode');
    }
    configService.setConnectionMode(mode);
    return true;
  });

  ipcMain.handle('get-connection-status', () => {
    return xrayService.isRunning();
  });

  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  registerPingHandlers({ deps, sendToRenderer, stripRawConfigs });

  ipcMain.handle('get-connection-monitor-status', () => {
    const status = connectionMonitorService.getStatus();
    return {
      ...status,
      autoSwitchingEnabled: connectionMonitorService.getAutoSwitchingEnabled(),
    };
  });

  ipcMain.handle('set-auto-switching', (_event: IpcMainInvokeEvent, enabledValue: unknown) => {
    const enabled = assertBoolean(enabledValue, 'auto switching value');
    connectionMonitorService.setAutoSwitchingEnabled(enabled);
    return true;
  });

  ipcMain.handle('clear-blocked-servers', () => {
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

    const uniqueConfigs = Array.from(new Map(configs.map((cfg) => [cfg.uuid, cfg])).values());
    logger.info('IPC', 'refreshSubscription success', { count: uniqueConfigs.length });
    
    const existingServers = configService.getServers();
    const pingDataMap = new Map<string, { ping: number | null; pingTime: number | undefined }>();
    existingServers.forEach(server => {
      if (server.ping !== undefined || server.pingTime !== undefined) {
        const key = `${server.address}:${server.port}`;
        pingDataMap.set(key, {
          ping: server.ping ?? null,
          pingTime: server.pingTime
        });
      }
    });
    
    const configsWithPing = uniqueConfigs.map(config => {
      const key = `${config.address}:${config.port}`;
      const pingData = pingDataMap.get(key);
      if (pingData) {
        return { ...config, ping: pingData.ping, pingTime: pingData.pingTime };
      }
      return config;
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
    await refreshSubscription(url, manualLinks);
  } else {
    logger.info('IPC', 'No subscription URL or manual links saved');
  }
}
