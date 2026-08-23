import { IpcMainInvokeEvent, ipcMain } from 'electron';
import { IPC_INVOKE_CHANNELS } from '@/shared/ipc';
import { logger } from '@/main/services/LoggerService';
import { IpcDependencies } from '@/main/ipc/dependencies';
import { assertBoolean } from '@/main/ipc/validators';
import type { SnapshotReason } from '@/main/runtime/SnapshotPublisher';

interface RegisterDiagnosticsHandlersParams {
  deps: IpcDependencies;
  assertTrustedSender: (event: IpcMainInvokeEvent) => void;
  notifySnapshot: (reason?: SnapshotReason) => void;
}

export function registerDiagnosticsHandlers({
  deps,
  assertTrustedSender,
  notifySnapshot,
}: RegisterDiagnosticsHandlersParams): void {
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.getLogs,
    async (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      try {
        return await deps.logExportService.getExportableLogs();
      } catch (e) {
        logger.error('IPC', 'get-logs failed', e);
        return '';
      }
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.openLogFolder,
    async (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      await deps.logExportService.openLogFolder();
      return true;
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.setAutoSwitching,
    (event: IpcMainInvokeEvent, enabledValue: unknown) => {
      assertTrustedSender(event);
      const enabled = assertBoolean(enabledValue, 'auto switching value');
      deps.connectionController.setAutoSwitchingEnabled(enabled);
      notifySnapshot('connection');
      return true;
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.clearBlockedServers,
    (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      deps.connectionController.clearBlockedServers();
      notifySnapshot('connection');
      return true;
    },
  );
}
