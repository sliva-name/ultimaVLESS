import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { IPC_INVOKE_CHANNELS } from '@/shared/ipc';
import { logger } from '@/main/services/LoggerService';
import { IpcDependencies } from '@/main/ipc/dependencies';
import { assertBoolean, assertValidServerPayload } from '@/main/ipc/validators';

interface RegisterPingHandlersParams {
  deps: IpcDependencies;
  assertTrustedSender: (event: IpcMainInvokeEvent) => void;
}

export function registerPingHandlers({
  deps,
  assertTrustedSender,
}: RegisterPingHandlersParams): void {
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.pingServer,
    async (_event: IpcMainInvokeEvent, serverPayload: unknown) => {
      assertTrustedSender(_event);
      try {
        const requestedServer = assertValidServerPayload(serverPayload);
        const storedServer = deps.serverRepository
          .list()
          .find((server) => server.uuid === requestedServer.uuid);
        if (!storedServer) {
          logger.error(
            'IPC',
            'ping-server failed',
            new Error('Server not found'),
          );
          return { uuid: requestedServer.uuid, latency: null };
        }

        const latency = await deps.pingService.pingServer(storedServer);
        return { uuid: storedServer.uuid, latency };
      } catch (error) {
        logger.error('IPC', 'ping-server failed', error);
        if (
          serverPayload &&
          typeof serverPayload === 'object' &&
          typeof (serverPayload as { uuid?: unknown }).uuid === 'string'
        ) {
          return {
            uuid: (serverPayload as { uuid: string }).uuid,
            latency: null,
          };
        }
        return { uuid: '', latency: null };
      }
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.pingAllServers,
    async (_event: IpcMainInvokeEvent, force: boolean = false) => {
      assertTrustedSender(_event);
      const forcePing =
        typeof force === 'undefined' ? false : assertBoolean(force, 'force');
      try {
        return await deps.pingRefresh.run({
          force: forcePing,
          trigger: 'user',
        });
      } catch (error) {
        logger.error('IPC', 'ping-all-servers failed', error);
        return [];
      }
    },
  );
}
