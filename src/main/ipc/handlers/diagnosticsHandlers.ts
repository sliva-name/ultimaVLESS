import { IpcMainInvokeEvent, ipcMain } from 'electron';
import { IPC_INVOKE_CHANNELS } from '@/shared/ipc';
import { logger } from '@/main/services/LoggerService';
import { IpcDependencies } from '@/main/ipc/dependencies';
import { buildConnectionMonitorStatusSummary } from '@/main/ipc/connectionStatusSummary';
import { assertBoolean } from '@/main/ipc/validators';

interface RegisterDiagnosticsHandlersParams {
  deps: IpcDependencies;
  assertTrustedSender: (event: IpcMainInvokeEvent) => void;
}

export function registerDiagnosticsHandlers({
  deps,
  assertTrustedSender,
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
    IPC_INVOKE_CHANNELS.getConnectionMonitorStatus,
    (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      return buildConnectionMonitorStatusSummary(
        deps.connectionMonitorService.getStatus(),
        deps.connectionMonitorService.getAutoSwitchingEnabled(),
        deps.xrayService.getHealthStatus(),
        deps.appRecoveryService.getStatus(),
      );
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.setAutoSwitching,
    (event: IpcMainInvokeEvent, enabledValue: unknown) => {
      assertTrustedSender(event);
      const enabled = assertBoolean(enabledValue, 'auto switching value');
      deps.connectionMonitorService.setAutoSwitchingEnabled(enabled);
      return true;
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.clearBlockedServers,
    (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      deps.connectionMonitorService.clearBlockedServers();
      return true;
    },
  );
}
