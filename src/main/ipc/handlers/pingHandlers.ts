import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { IPC_INVOKE_CHANNELS } from '@/shared/ipc';
import { logger } from '@/main/services/LoggerService';
import { IpcDependencies } from '@/main/ipc/dependencies';
import { assertBoolean, assertValidServerPayload } from '@/main/ipc/validators';
import { isPingUnsafePhase } from '@/main/runtime/pingRefresh';

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

        if (
          isPingUnsafePhase(
            deps.connectionManager.getPhase(),
            deps.connectionManager.isBusy(),
          )
        ) {
          return {
            uuid: storedServer.uuid,
            latency: storedServer.ping ?? null,
          };
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
    async (
      _event: IpcMainInvokeEvent,
      force: boolean = false,
      serverIds?: unknown,
    ) => {
      assertTrustedSender(_event);
      const forcePing =
        typeof force === 'undefined' ? false : assertBoolean(force, 'force');
      if (
        serverIds !== undefined &&
        (!Array.isArray(serverIds) ||
          !serverIds.every(
            (id): id is string => typeof id === 'string' && id.length > 0,
          ))
      ) {
        throw new Error('Invalid server IDs');
      }
      try {
        return await deps.pingRefresh.run({
          force: forcePing,
          trigger: 'user',
          serverIds: serverIds as string[] | undefined,
        });
      } catch (error) {
        logger.error('IPC', 'ping-all-servers failed', error);
        return [];
      }
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.stopPingAllServers,
    async (_event: IpcMainInvokeEvent): Promise<boolean> => {
      assertTrustedSender(_event);
      try {
        deps.pingRefresh.stop();
        return true;
      } catch (error) {
        logger.error('IPC', 'stop-ping-all-servers failed', error);
        return false;
      }
    },
  );
}
