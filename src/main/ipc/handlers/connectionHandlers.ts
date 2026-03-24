import { ipcMain, IpcMainEvent } from 'electron';
import { logger } from '../../services/LoggerService';
import { IpcDependencies } from '../dependencies';
import { assertValidServerPayload } from '../validators';

interface RegisterConnectionHandlersParams {
  deps: IpcDependencies;
  handleAsync: (operation: string, fn: () => Promise<void>) => Promise<void>;
}

export function registerConnectionHandlers({ deps, handleAsync }: RegisterConnectionHandlersParams): void {
  ipcMain.on('connect', (event: IpcMainEvent, configPayload: unknown) => {
    void handleAsync('connect', async () => {
      const requestedConfig = assertValidServerPayload(configPayload);
      logger.info('IPC', 'connect', {
        configName: requestedConfig.name,
        serverId: requestedConfig.uuid.substring(0, 8),
      });

      try {
        const storedServers = deps.configService.getServers();
        const fullConfig = storedServers.find((s) => s.uuid === requestedConfig.uuid);
        if (!fullConfig) {
          throw new Error('Selected server was not found in local configuration');
        }

        const connectionMode = deps.configService.getConnectionMode();

        if (connectionMode === 'tun' && !(await deps.isElevatedOnWindows())) {
          const relaunched = await deps.relaunchAsAdminOnWindows();
          if (relaunched) {
            event.reply('connection-error', 'Restarting UltimaVLESS with Administrator rights...');
            deps.app.releaseSingleInstanceLock();
            deps.app.quit();
            return;
          }
          throw new Error('TUN mode requires Administrator rights. Please approve UAC prompt or run UltimaVLESS as Administrator.');
        }

        if (connectionMode === 'tun') {
          await deps.tunRouteService.disable();
        }

        await deps.xrayService.start(fullConfig, connectionMode);
        if (connectionMode === 'proxy') {
          await deps.systemProxyService.enable(deps.constants.ports.http, deps.constants.ports.socks);
        } else {
          await deps.systemProxyService.disable();
          await deps.tunRouteService.enable(fullConfig);
        }

        deps.configService.setSelectedServerId(fullConfig.uuid);
        deps.connectionMonitorService.startMonitoring(fullConfig);
        event.reply('connection-status', true);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('IPC', 'Failed to connect', error);
        deps.connectionMonitorService.recordError(errorMessage);

        await deps.xrayService.stop().catch((stopError) => {
          logger.error('IPC', 'Failed to stop xray after connect failure', stopError);
        });
        await deps.systemProxyService.disable().catch((proxyError) => {
          logger.error('IPC', 'Failed to disable proxy after connect failure', proxyError);
        });
        await deps.tunRouteService.disable().catch((tunError) => {
          logger.error('IPC', 'Failed to disable TUN routes after connect failure', tunError);
        });
        event.reply('connection-error', errorMessage);
        event.reply('connection-status', false);
      }
    });
  });

  ipcMain.on('disconnect', (event: IpcMainEvent) => {
    void handleAsync('disconnect', async () => {
      logger.info('IPC', 'disconnect');
      try {
        deps.connectionMonitorService.stopMonitoring();
        await deps.systemProxyService.disable();
        await deps.tunRouteService.disable();
        await deps.xrayService.stop();
      } finally {
        event.reply('connection-status', false);
      }
    });
  });
}
