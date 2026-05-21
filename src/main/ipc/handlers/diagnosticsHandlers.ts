import { IpcMainInvokeEvent, ipcMain } from 'electron';
import { IPC_INVOKE_CHANNELS } from '@/shared/ipc';
import { appRecoveryService } from '@/main/services/AppRecoveryService';
import { connectionMonitorService } from '@/main/services/ConnectionMonitorService';
import { logExportService } from '@/main/services/LogExportService';
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
        return await logExportService.getExportableLogs();
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
      await logExportService.openLogFolder();
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
        appRecoveryService.getStatus(),
      );
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.setAutoSwitching,
    (event: IpcMainInvokeEvent, enabledValue: unknown) => {
      assertTrustedSender(event);
      const enabled = assertBoolean(enabledValue, 'auto switching value');
      connectionMonitorService.setAutoSwitchingEnabled(enabled);
      return true;
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.clearBlockedServers,
    (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      connectionMonitorService.clearBlockedServers();
      return true;
    },
  );
}
