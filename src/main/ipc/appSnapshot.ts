import { IpcMainInvokeEvent, ipcMain } from 'electron';
import { AppSnapshot, IPC_INVOKE_CHANNELS } from '@/shared/ipc';
import { lastErrorFromState } from '@/main/domain/connection/ConnectionState';
import { toSafeServerList } from '@/shared/serverView';
import { IpcDependencies } from './dependencies';

export function buildAppSnapshot(deps: IpcDependencies): AppSnapshot {
  const monitorStatus = deps.connectionMonitorService.getStatus();
  const activeServerId = monitorStatus.currentServer?.uuid ?? null;
  const selectedServerId =
    deps.configService.getSelectedServerId() ?? activeServerId;
  return {
    servers: toSafeServerList(deps.serverRepository.list()),
    subscriptions: deps.subscriptionRepository.list(),
    selectedServerId,
    connectionMode: deps.configService.getConnectionMode(),
    session: {
      // Controller is the single owner of the UI verb — no monitor reconciliation.
      phase: deps.connectionController.getPhase(),
      activeServerId,
      lastError:
        monitorStatus.lastError ??
        lastErrorFromState(deps.connectionController.getConnectionState()),
      blockedServerIds: monitorStatus.blockedServers,
    },
    traffic: deps.trafficStatsService.getLastSnapshot(),
  };
}

export function registerAppSnapshotHandler({
  deps,
  assertTrustedSender,
}: {
  deps: IpcDependencies;
  assertTrustedSender: (event: IpcMainInvokeEvent) => void;
}): void {
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.getAppSnapshot,
    (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      return buildAppSnapshot(deps);
    },
  );
}
