import { IpcMainInvokeEvent, ipcMain } from 'electron';
import {
  AppSnapshot,
  IPC_INVOKE_CHANNELS,
  type AppHealthSnapshot,
  type AppSessionSnapshot,
} from '@/shared/ipc';
import {
  activeServerIdFromState,
  lastErrorFromState,
} from '@/main/domain/connection/ConnectionState';
import { toSafeServerList } from '@/shared/serverView';
import { IpcDependencies } from './dependencies';

export function buildSessionSnapshot(deps: IpcDependencies): AppSessionSnapshot {
  const connectionState = deps.connectionController.getConnectionState();
  return {
    phase: deps.connectionController.getPhase(),
    activeServerId: activeServerIdFromState(connectionState),
    lastError: lastErrorFromState(connectionState),
    blockedServerIds: deps.connectionController.getBlockedServerIds(),
  };
}

export function buildHealthSnapshot(deps: IpcDependencies): AppHealthSnapshot {
  const probe = deps.connectionMonitorService.getStatus();
  return {
    lastHealthState: probe.lastHealthState,
    lastHealthFailureReason: probe.lastHealthFailureReason,
    lastHealthCheckAt: probe.lastHealthCheckAt,
    localProxyReachable: probe.localProxyReachable,
  };
}

export function buildAppSnapshot(deps: IpcDependencies): AppSnapshot {
  const connectionState = deps.connectionController.getConnectionState();
  const activeServerId = activeServerIdFromState(connectionState);
  const selectedServerId =
    deps.configService.getSelectedServerId() ?? activeServerId;
  const session = buildSessionSnapshot(deps);
  return {
    servers: toSafeServerList(deps.serverRepository.list()),
    subscriptions: deps.subscriptionRepository.list(),
    selectedServerId,
    connectionMode: deps.configService.getConnectionMode(),
    session,
    health: buildHealthSnapshot(deps),
    process: deps.xrayService.getHealthStatus(),
    recovery: deps.appRecoveryService.getStatus(),
    autoSwitchingEnabled: deps.connectionController.getAutoSwitchingEnabled(),
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
