import { IpcMainInvokeEvent, ipcMain } from 'electron';
import { IPC_INVOKE_CHANNELS } from '@/shared/ipc';
import { IpcDependencies } from '@/main/ipc/dependencies';

interface RegisterUpdateHandlersParams {
  deps: IpcDependencies;
  assertTrustedSender: (event: IpcMainInvokeEvent) => void;
}

export function registerUpdateHandlers({
  deps,
  assertTrustedSender,
}: RegisterUpdateHandlersParams): void {
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.getUpdateStatus,
    (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      return deps.appUpdaterService.getStatus();
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.checkForUpdates,
    async (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      await deps.appUpdaterService.checkForUpdates();
      return deps.appUpdaterService.getStatus();
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.installUpdate,
    (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      deps.appUpdaterService.quitAndInstall();
      return true;
    },
  );
}
