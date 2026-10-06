import { IpcMainInvokeEvent, ipcMain } from 'electron';
import { IPC_INVOKE_CHANNELS } from '@/shared/ipc';
import { IpcDependencies } from '@/main/ipc/dependencies';

interface RegisterTunEnvironmentHandlersParams {
  deps: IpcDependencies;
  assertTrustedSender: (event: IpcMainInvokeEvent) => void;
}

const MAX_APP_ID_LENGTH = 64;

/** Network adapters for the TUN outbound picker, and conflicting VPN software. */
export function registerTunEnvironmentHandlers({
  deps,
  assertTrustedSender,
}: RegisterTunEnvironmentHandlersParams): void {
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.listNetworkAdapters,
    async (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      return deps.tunRouteService.listNetworkAdapters();
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.scanConflictingApps,
    async (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      return deps.conflictingAppsService.scan();
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.closeConflictingApp,
    async (event: IpcMainInvokeEvent, appId: unknown) => {
      assertTrustedSender(event);
      if (
        typeof appId !== 'string' ||
        appId.length === 0 ||
        appId.length > MAX_APP_ID_LENGTH
      ) {
        throw new Error('Invalid application id');
      }
      return deps.conflictingAppsService.close(appId);
    },
  );
}
