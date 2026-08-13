import type { VlessConfig } from '@/shared/types';
import type { SessionPhase } from '@/shared/ipc';
import { IPC_EVENT_CHANNELS, type IpcEventChannel } from '@/shared/ipc';
import { trayService } from '@/main/services/TrayService';
import type { IpcDependencies } from '@/main/ipc/dependencies';
import type { SnapshotPublisher } from './SnapshotPublisher';
import type { ConnectionRecovery } from './ConnectionRecovery';
import type { HealthFailureEvent } from '@/main/services/ConnectionMonitorService';

interface RegisterRuntimeEventsParams {
  deps: IpcDependencies;
  snapshotPublisher: SnapshotPublisher;
  recovery: ConnectionRecovery;
  sendToRenderer: (channel: IpcEventChannel, ...args: unknown[]) => void;
}

function syncTrayAndTrafficForPhase(
  deps: IpcDependencies,
  phase: SessionPhase,
): void {
  if (phase === 'connecting' || phase === 'switching') {
    if (phase === 'connecting') {
      trayService.setConnecting();
    } else {
      trayService.reportSwitching();
    }
    return;
  }

  if (phase === 'disconnecting') {
    return;
  }

  if (phase === 'connected') {
    const status = deps.connectionMonitorService.getStatus();
    const server = status.currentServer;
    if (!server) return;
    trayService.setConnected(server.name, server.ping ?? null);
    const connectedAt = status.lastConnectionTime ?? Date.now();
    deps.trafficStatsService.start(
      connectedAt,
      deps.xrayService.getActivePorts?.()?.api,
    );
    return;
  }

  trayService.setDisconnected();
  deps.trafficStatsService.stop();
}

export function registerRuntimeEvents({
  deps,
  snapshotPublisher,
  recovery,
  sendToRenderer,
}: RegisterRuntimeEventsParams): void {
  deps.xrayService.removeAllListeners('unexpected-exit');
  deps.xrayService.on('unexpected-exit', (event) => {
    void recovery.handleUnexpectedXrayExit(event.reason);
  });
  deps.xrayService.removeAllListeners('health-changed');
  deps.xrayService.on('health-changed', (healthStatus) => {
    deps.connectionMonitorService.handleXrayHealthStatusChanged(healthStatus);
  });

  deps.connectionMonitorService.removeAllListeners('health-failure');
  deps.connectionMonitorService.on(
    'health-failure',
    (event: HealthFailureEvent) => {
      deps.connectionController.handleHealthFailure(event);
    },
  );

  deps.connectionController.removeAllListeners('phase-changed');
  deps.connectionController.removeAllListeners('busy-changed');
  deps.connectionController.removeAllListeners('state-changed');
  deps.connectionController.on('phase-changed', (phase: SessionPhase) => {
    snapshotPublisher.push('connection');
    syncTrayAndTrafficForPhase(deps, phase);
  });

  deps.trafficStatsService.removeAllListeners('snapshot');
  deps.trafficStatsService.on('snapshot', () => {
    snapshotPublisher.push('traffic');
  });
  deps.trafficStatsService.removeAllListeners('stopped');
  deps.trafficStatsService.on('stopped', () => {
    snapshotPublisher.push('traffic');
  });

  deps.appUpdaterService.removeAllListeners('status');
  deps.appUpdaterService.on('status', (status) => {
    sendToRenderer(IPC_EVENT_CHANNELS.updateStatus, status);
  });
  deps.appUpdaterService.setConnectionBusyGetter(() =>
    deps.connectionController.isBusy(),
  );

  const monitorEvents = [
    'connected',
    'disconnected',
    'error',
    'blocked',
    'switching',
  ] as const;
  for (const eventName of monitorEvents) {
    deps.connectionMonitorService.on(eventName, (event) => {
      const safeEvent = { ...event };
      if (safeEvent.server) {
        const { rawConfig: _rawConfig, ...restServer } = safeEvent.server;
        safeEvent.server = restServer as VlessConfig;
      }
      sendToRenderer(IPC_EVENT_CHANNELS.connectionMonitorEvent, safeEvent);
      snapshotPublisher.push('monitor');

      if (eventName === 'error') {
        const message =
          (event as { error?: string; message?: string }).error ??
          (event as { message?: string }).message ??
          '';
        if (message) {
          trayService.reportError(message);
        }
      }
    });
  }
}
