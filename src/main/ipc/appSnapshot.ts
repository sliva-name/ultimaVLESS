import { IpcMainInvokeEvent, ipcMain } from 'electron';
import {
  AppSessionStatus,
  AppSnapshot,
  IPC_INVOKE_CHANNELS,
} from '@/shared/ipc';
import { toSafeServerList } from '@/shared/serverView';
import { IpcDependencies } from './dependencies';

function getSessionStatus(params: {
  busy: boolean;
  connected: boolean;
  hasError: boolean;
}): AppSessionStatus {
  if (params.busy && params.connected) return 'switching';
  if (params.busy) return 'connecting';
  if (params.connected) return 'connected';
  if (params.hasError) return 'failed';
  return 'idle';
}

export function buildAppSnapshot(
  deps: IpcDependencies,
): AppSnapshot {
  const monitorStatus = deps.connectionMonitorService.getStatus();
  const busy = deps.connectionController.isBusy();
  const activeServerId = monitorStatus.currentServer?.uuid ?? null;
  const selectedServerId =
    deps.configService.getSelectedServerId() ?? activeServerId;
  return {
    servers: toSafeServerList(deps.configService.getServers()),
    subscriptions: deps.configService.getSubscriptions(),
    selectedServerId,
    connectionMode: deps.configService.getConnectionMode(),
    session: {
      status: deps.connectionController.isBusy()
        ? deps.connectionController.getState()
        : getSessionStatus({
            busy,
            connected: monitorStatus.isConnected,
            hasError: !!monitorStatus.lastError,
          }),
      busy,
      activeServerId,
      lastError: monitorStatus.lastError,
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
