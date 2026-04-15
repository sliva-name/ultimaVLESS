import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { logger } from '../../services/LoggerService';
import { IpcDependencies } from '../dependencies';
import { assertValidServerPayload } from '../validators';
import { IpcEventChannel, IPC_EVENT_CHANNELS, IPC_INVOKE_CHANNELS } from '../../../shared/ipc';
import { createSerialQueue } from '../serialQueue';

interface RegisterConnectionHandlersParams {
  deps: IpcDependencies;
  assertTrustedSender: (event: IpcMainInvokeEvent) => void;
  sendToRenderer: (channel: IpcEventChannel, ...args: unknown[]) => void;
  beginConnectionBusy: () => void;
  endConnectionBusy: () => void;
}

export function registerConnectionHandlers({
  deps,
  assertTrustedSender,
  sendToRenderer,
  beginConnectionBusy,
  endConnectionBusy,
}: RegisterConnectionHandlersParams): void {
  const connectionOperationQueue = createSerialQueue();
  const runConnectionOperation = <T>(operationName: string, fn: () => Promise<T>): Promise<T> => {
    return connectionOperationQueue.enqueue(async () => {
      logger.info('IPC', 'connection operation started', { operationName });
      beginConnectionBusy();
      try {
        return await fn();
      } finally {
        endConnectionBusy();
        logger.info('IPC', 'connection operation finished', { operationName });
      }
    });
  };

  ipcMain.handle(IPC_INVOKE_CHANNELS.connect, async (event: IpcMainInvokeEvent, configPayload: unknown) => {
    assertTrustedSender(event);
    return runConnectionOperation('connect', async () => {
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

        const monitorStatus = deps.connectionMonitorService.getStatus();
        if (
          deps.xrayService.isRunning() &&
          monitorStatus.isConnected &&
          monitorStatus.currentServer?.uuid === fullConfig.uuid
        ) {
          logger.info('IPC', 'connect skipped: already connected to selected server', {
            serverId: fullConfig.uuid.substring(0, 8),
            connectionMode,
          });
          return { ok: true as const };
        }

        if (connectionMode === 'tun' && !deps.tunRouteService.isSupported()) {
          throw new Error(deps.tunRouteService.getUnsupportedReason() || 'TUN mode is not supported on this operating system.');
        }

        if (connectionMode === 'tun' && !(await deps.hasTunPrivileges())) {
          if (process.platform === 'win32') {
            deps.configService.setSelectedServerId(fullConfig.uuid);
            deps.configService.setPendingTunReconnect(fullConfig.uuid);
            const relaunched = await deps.requestTunPrivilegesRelaunch();
            if (relaunched) {
              sendToRenderer(IPC_EVENT_CHANNELS.connectionError, 'Restarting UltimaVLESS with Administrator rights...');
              deps.app.releaseSingleInstanceLock();
              deps.app.quit();
              return { ok: false as const, error: 'Restarting as administrator', relaunched: true as const };
            }
            deps.configService.clearPendingTunReconnect();
            throw new Error('TUN mode requires Administrator rights. Please approve UAC prompt or run UltimaVLESS as Administrator.');
          }
          throw new Error('TUN mode requires root privileges on this operating system. Please run the app with elevated permissions.');
        }

        await deps.connectionStackService.transitionTo(fullConfig, connectionMode, deps.constants.ports, {
          stopXray: true,
        });

        deps.configService.clearPendingTunReconnect();
        deps.configService.setSelectedServerId(fullConfig.uuid);
        deps.connectionMonitorService.startMonitoring(fullConfig);
        return { ok: true as const };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('IPC', 'Failed to connect', error);
        deps.connectionMonitorService.recordError(errorMessage);

        try {
          await deps.connectionStackService.cleanupAfterFailure();
        } catch (cleanupError) {
          logger.error('IPC', 'Failed to cleanup network stack after connect failure', cleanupError);
        }
        sendToRenderer(IPC_EVENT_CHANNELS.connectionError, errorMessage);
        return { ok: false as const, error: errorMessage };
      }
    });
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.disconnect, async (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event);
    return runConnectionOperation('disconnect', async () => {
      logger.info('IPC', 'disconnect');
      try {
        deps.configService.clearPendingTunReconnect();
        await deps.connectionStackService.resetNetworkingStack({ stopXray: true });
        deps.connectionMonitorService.stopMonitoring({
          message: 'Disconnected',
        });
        return { ok: true as const };
      } catch (error) {
        logger.error('IPC', 'Failed to disconnect', error);
        return { ok: false as const };
      }
    });
  });
}
