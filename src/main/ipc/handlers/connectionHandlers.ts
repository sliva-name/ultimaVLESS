import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { logger } from '@/main/services/LoggerService';
import { IpcDependencies } from '@/main/ipc/dependencies';
import { IPC_INVOKE_CHANNELS } from '@/shared/ipc';
import { ConnectionControllerRelaunchError } from '@/main/services/ConnectionController';

function assertServerId(payload: unknown): string {
  if (typeof payload !== 'string' || payload.trim().length === 0) {
    throw new Error('Invalid server id');
  }
  return payload;
}

interface RegisterConnectionHandlersParams {
  deps: IpcDependencies;
  assertTrustedSender: (event: IpcMainInvokeEvent) => void;
}

export function registerConnectionHandlers({
  deps,
  assertTrustedSender,
}: RegisterConnectionHandlersParams): void {
  const handleConnectFailure = (error: unknown) => {
    if (error instanceof ConnectionControllerRelaunchError) {
      return {
        ok: false as const,
        error: error.message,
        relaunched: true as const,
      };
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('IPC', 'Failed to connect', error);
    return { ok: false as const, error: errorMessage };
  };

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.connect,
    async (event: IpcMainInvokeEvent, serverIdPayload: unknown) => {
      assertTrustedSender(event);
      const requestedServerId = assertServerId(serverIdPayload);
      logger.info('IPC', 'connect', {
        serverId: requestedServerId.substring(0, 8),
      });
      try {
        await deps.connectionController.connect(requestedServerId);
        return { ok: true as const };
      } catch (error) {
        return handleConnectFailure(error);
      }
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.disconnect,
    async (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      logger.info('IPC', 'disconnect');
      try {
        await deps.connectionController.disconnect();
        return { ok: true as const };
      } catch (error) {
        logger.error('IPC', 'Failed to disconnect', error);
        return { ok: false as const };
      }
    },
  );
}
