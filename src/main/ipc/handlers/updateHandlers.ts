import { IpcMainInvokeEvent, ipcMain } from 'electron';
import { IPC_INVOKE_CHANNELS } from '@/shared/ipc';
import { appUpdaterService } from '@/main/services/AppUpdaterService';
import { trafficStatsService } from '@/main/services/TrafficStatsService';

interface RegisterUpdateHandlersParams {
  assertTrustedSender: (event: IpcMainInvokeEvent) => void;
}

export function registerUpdateHandlers({
  assertTrustedSender,
}: RegisterUpdateHandlersParams): void {
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.getTrafficStats,
    (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      return trafficStatsService.getLastSnapshot();
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.getUpdateStatus,
    (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      return appUpdaterService.getStatus();
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.checkForUpdates,
    async (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      await appUpdaterService.checkForUpdates();
      return appUpdaterService.getStatus();
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.installUpdate,
    (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      appUpdaterService.quitAndInstall();
      return true;
    },
  );
}
