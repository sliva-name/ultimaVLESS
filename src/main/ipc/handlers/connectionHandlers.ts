import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { logger } from '../../services/LoggerService';
import { IpcDependencies } from '../dependencies';
import { assertValidServerPayload } from '../validators';

interface RegisterConnectionHandlersParams {
  deps: IpcDependencies;
  handleAsync: (operation: string, fn: () => Promise<void>) => Promise<void>;
  assertTrustedSender: (event: IpcMainInvokeEvent) => void;
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
}

export function registerConnectionHandlers({ deps, handleAsync, assertTrustedSender, sendToRenderer }: RegisterConnectionHandlersParams): void {
  ipcMain.handle('connect', async (event: IpcMainInvokeEvent, configPayload: unknown) => {
    assertTrustedSender(event);
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
      logger.info('IPC', 'connect mode selected', { connectionMode });

      if (connectionMode === 'tun' && !(await deps.isElevatedOnWindows())) {
        const relaunched = await deps.relaunchAsAdminOnWindows();
        if (relaunched) {
          sendToRenderer('connection-error', 'Restarting UltimaVLESS with Administrator rights...');
          deps.app.releaseSingleInstanceLock();
          deps.app.quit();
          return { ok: false as const, error: 'Restarting as administrator', relaunched: true as const };
        }
        throw new Error('TUN mode requires Administrator rights. Please approve UAC prompt or run UltimaVLESS as Administrator.');
      }

      // Always reset both networking modes first to avoid stale routes/proxy state.
      // This prevents "works only after mode toggle/update" behavior.
      await deps.systemProxyService.disable();
      await deps.tunRouteService.disable();

      await deps.xrayService.start(fullConfig, connectionMode);
      if (connectionMode === 'proxy') {
        await deps.systemProxyService.enable(deps.constants.ports.http, deps.constants.ports.socks);
      } else {
        await deps.systemProxyService.disable();
        await deps.tunRouteService.enable(fullConfig);
      }

      deps.configService.setSelectedServerId(fullConfig.uuid);
      deps.connectionMonitorService.startMonitoring(fullConfig);
      return { ok: true as const };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('IPC', 'Failed to connect', error);
      deps.connectionMonitorService.recordError(errorMessage);

      try {
        deps.xrayService.stop();
      } catch (stopError) {
        logger.error('IPC', 'Failed to stop xray after connect failure', stopError);
      }
      try {
        await deps.systemProxyService.disable();
      } catch (proxyError) {
        logger.error('IPC', 'Failed to disable proxy after connect failure', proxyError);
      }
      try {
        await deps.tunRouteService.disable();
      } catch (tunError) {
        logger.error('IPC', 'Failed to disable TUN routes after connect failure', tunError);
      }
      sendToRenderer('connection-error', errorMessage);
      return { ok: false as const, error: errorMessage };
    }
  });

  ipcMain.handle('disconnect', async (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    let ok = true;
    await handleAsync('disconnect', async () => {
      logger.info('IPC', 'disconnect');
      try {
        deps.connectionMonitorService.stopMonitoring();
        await deps.systemProxyService.disable();
        await deps.tunRouteService.disable();
        deps.xrayService.stop();
      } catch (error) {
        ok = false;
        throw error;
      }
    });
    return { ok };
  });
}
