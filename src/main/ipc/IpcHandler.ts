import { ipcMain, IpcMainInvokeEvent, IpcMainEvent, BrowserWindow, app } from 'electron';
import { VlessConfig } from '../../shared/types';
import { APP_CONSTANTS } from '../../shared/constants';
import { xrayService } from '../services/XrayService';
import { configService } from '../services/ConfigService';
import { subscriptionService } from '../services/SubscriptionService';
import { logger } from '../services/LoggerService';
import { systemProxyService } from '../services/SystemProxyService';
import { logExportService } from '../services/LogExportService';
import { connectionMonitorService } from '../services/ConnectionMonitorService';
import { pingService } from '../services/PingService';

export function registerIpcHandlers(mainWindow: BrowserWindow) {
  
  // Wrapper for async handlers to ensure consistency
  const handleAsync = async (operation: string, fn: () => Promise<void>) => {
      try {
          await fn();
      } catch (error) {
          logger.error('IPC', `Operation failed: ${operation}`, error);
      }
  };

  ipcMain.handle('save-subscription', async (event: IpcMainInvokeEvent, url: string) => {
    logger.info('IPC', 'save-subscription', { url });
    try {
        configService.setSubscriptionUrl(url);
        await refreshSubscription(mainWindow, url);
        return true;
    } catch (e) {
        logger.error('IPC', 'save-subscription failed', e);
        throw e;
    }
  });

  ipcMain.on('connect', (event: IpcMainEvent, config: VlessConfig) => {
    handleAsync('connect', async () => {
        logger.info('IPC', 'connect', { configName: config.name });
        try {
          await xrayService.start(config);
          await systemProxyService.enable(APP_CONSTANTS.PORTS.HTTP, APP_CONSTANTS.PORTS.SOCKS);
          
          configService.setSelectedServerId(config.uuid);
          
          // Запускаем мониторинг соединения
          connectionMonitorService.startMonitoring(config);
          
          event.reply('connection-status', true);
        } catch (error) {
          // Specific error handling for connection flow
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error('IPC', 'Failed to connect', error);
          
          // Записываем ошибку в мониторинг
          connectionMonitorService.recordError(errorMessage, config);
          
          xrayService.stop();
          await systemProxyService.disable();
          event.reply('connection-status', false);
        }
    });
  });

  ipcMain.on('disconnect', (event: IpcMainEvent) => {
    handleAsync('disconnect', async () => {
        logger.info('IPC', 'disconnect');
        
        // Останавливаем мониторинг
        connectionMonitorService.stopMonitoring();
        
        await systemProxyService.disable();
        xrayService.stop();
        event.reply('connection-status', false);
    });
  });

  // Log handlers
  ipcMain.handle('get-logs', async () => {
    try {
        return await logExportService.getExportableLogs();
    } catch (e) {
        logger.error('IPC', 'get-logs failed', e);
        return 'Failed to retrieve logs.';
    }
  });

  ipcMain.on('open-log-folder', () => {
      logExportService.openLogFolder();
  });

  ipcMain.handle('get-servers', () => {
    return configService.getServers();
  });

  ipcMain.handle('get-subscription-url', () => {
    return configService.getSubscriptionUrl();
  });

  ipcMain.handle('get-selected-server-id', () => {
    return configService.getSelectedServerId();
  });

  ipcMain.handle('get-connection-status', () => {
    return xrayService.isRunning();
  });

  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  // Ping handlers
  ipcMain.handle('ping-server', async (event: IpcMainInvokeEvent, server: VlessConfig) => {
    try {
      const latency = await pingService.pingServer(server);
      return { uuid: server.uuid, latency };
    } catch (error) {
      logger.error('IPC', 'ping-server failed', error);
      return { uuid: server.uuid, latency: null };
    }
  });

  ipcMain.handle('ping-all-servers', async (event: IpcMainInvokeEvent, force: boolean = false) => {
    try {
      const servers = configService.getServers();
      
      // Check if we should skip ping (if not forced and pinged recently)
      if (!force && servers.length > 0) {
        const now = Date.now();
        const MIN_PING_INTERVAL = 30000; // 30 seconds
        
        // Check if all servers have ping data
        const serversWithPing = servers.filter(s => s.pingTime && s.pingTime > 0);
        
        // If not all servers have ping data, always ping
        if (serversWithPing.length < servers.length) {
          logger.debug('IPC', 'Pinging - not all servers have ping data', { 
            total: servers.length, 
            withPing: serversWithPing.length 
          });
        } else {
          // All servers have ping data, check if recent enough
          const oldestPingTime = Math.min(...servers.map(s => s.pingTime || 0).filter(t => t > 0));
          const timeSinceLastPing = now - oldestPingTime;
          
          // If all servers have recent ping data, skip
          if (oldestPingTime > 0 && timeSinceLastPing < MIN_PING_INTERVAL) {
            logger.debug('IPC', 'Skipping ping - too soon since last ping', { timeSinceLastPing });
            return Array.from(servers.map(s => ({ uuid: s.uuid, latency: s.ping ?? null })));
          }
        }
      }
      
      const results = await pingService.pingServers(servers);
      
      // Log ping results for debugging
      logger.debug('IPC', 'Ping results', {
        resultsCount: results.size,
        results: Array.from(results.entries()).map(([key, latency]) => ({
          key,
          latency
        }))
      });
      
      // Update servers with ping results
      // Use address:port as key since UUIDs might not be unique
      const updatedServers = servers.map(server => {
        const key = `${server.address}:${server.port}`;
        const ping = results.get(key) ?? null;
        return {
          ...server,
          ping,
          pingTime: Date.now()
        };
      });
      
      configService.setServers(updatedServers);
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-servers', updatedServers);
      }
      
      return Array.from(results.entries()).map(([uuid, latency]) => ({ uuid, latency }));
    } catch (error) {
      logger.error('IPC', 'ping-all-servers failed', error);
      return [];
    }
  });

  // Connection monitoring handlers
  ipcMain.handle('get-connection-monitor-status', () => {
    const status = connectionMonitorService.getStatus();
    return {
      ...status,
      autoSwitchingEnabled: connectionMonitorService.getAutoSwitchingEnabled(),
    };
  });

  ipcMain.handle('set-auto-switching', (event: IpcMainInvokeEvent, enabled: boolean) => {
    connectionMonitorService.setAutoSwitchingEnabled(enabled);
    return true;
  });

  ipcMain.handle('clear-blocked-servers', () => {
    connectionMonitorService.clearBlockedServers();
    return true;
  });

  // Подписываемся на события мониторинга и отправляем их в renderer
  connectionMonitorService.on('connected', (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('connection-monitor-event', event);
    }
  });

  connectionMonitorService.on('disconnected', (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('connection-monitor-event', event);
    }
  });

  connectionMonitorService.on('error', (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('connection-monitor-event', event);
    }
  });

  connectionMonitorService.on('blocked', (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('connection-monitor-event', event);
    }
  });

  connectionMonitorService.on('switching', (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('connection-monitor-event', event);
    }
  });

  // При успешном переключении отправляем обновленный статус
  connectionMonitorService.on('connected', (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Если это было автоматическое переключение, отправляем статус соединения
      if (event.server) {
        mainWindow.webContents.send('connection-status', true);
      }
    }
  });
}

async function refreshSubscription(window: BrowserWindow, url: string) {
  logger.info('IPC', 'refreshSubscription start', { url });
  try {
    const configs = await subscriptionService.fetchAndParse(url);
    logger.info('IPC', 'refreshSubscription success', { count: configs.length });
    
    // Preserve ping data from existing servers
    // Use address:port as key since UUIDs might not be unique
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
    
    // Merge ping data into new configs
    const configsWithPing = configs.map(config => {
      const key = `${config.address}:${config.port}`;
      const pingData = pingDataMap.get(key);
      if (pingData) {
        return {
          ...config,
          ping: pingData.ping,
          pingTime: pingData.pingTime
        };
      }
      return config;
    });
    
    configService.setServers(configsWithPing);
    
    if (window && !window.isDestroyed()) {
        window.webContents.send('update-servers', configsWithPing);
    }
  } catch (error) {
    logger.error('IPC', 'Failed to update subscription', error);
  }
}

export async function loadInitialState(window: BrowserWindow) {
    logger.info('IPC', 'loadInitialState called');
    const url = configService.getSubscriptionUrl();
    logger.info('IPC', 'loadInitialState', { hasUrl: !!url, url });
    
    // Always send saved servers to renderer, even if no subscription URL
    const savedServers = configService.getServers();
    if (window && !window.isDestroyed()) {
        window.webContents.send('update-servers', savedServers);
    }
    
    if (url) {
        await refreshSubscription(window, url);
    } else {
        logger.info('IPC', 'No subscription URL saved');
    }
}
