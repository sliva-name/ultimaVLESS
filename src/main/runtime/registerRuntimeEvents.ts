import type { VlessConfig } from '@/shared/types';
import { IPC_EVENT_CHANNELS, type IpcEventChannel } from '@/shared/ipc';
import { trayService } from '@/main/services/TrayService';
import type { IpcDependencies } from '@/main/ipc/dependencies';
import type { SnapshotPublisher } from './SnapshotPublisher';
import type { ConnectionRecovery } from './ConnectionRecovery';

interface RegisterRuntimeEventsParams {
  deps: IpcDependencies;
  snapshotPublisher: SnapshotPublisher;
  recovery: ConnectionRecovery;
  sendToRenderer: (channel: IpcEventChannel, ...args: unknown[]) => void;
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

  deps.connectionMonitorService.removeAllListeners('switch-operation-started');
  deps.connectionMonitorService.removeAllListeners('switch-operation-finished');
  deps.connectionMonitorService.setSwitchExecutor((server) =>
    deps.connectionController.transitionForAutoSwitch(server),
  );
  deps.connectionMonitorService.setCleanupExecutor(() =>
    deps.connectionController.cleanupAfterFailure(),
  );
  deps.connectionMonitorService.on('switch-operation-started', () => {
    snapshotPublisher.push('connection');
  });
  deps.connectionMonitorService.on('switch-operation-finished', () => {
    snapshotPublisher.push('connection');
  });

  deps.connectionController.removeAllListeners('busy-changed');
  deps.connectionController.on('busy-changed', () => {
    snapshotPublisher.push('connection');
  });
  deps.connectionController.removeAllListeners('state-changed');
  deps.connectionController.on('state-changed', (state) => {
    snapshotPublisher.push('connection');
    if (state === 'connecting') {
      trayService.setConnecting();
    }
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

      if (eventName === 'connected' && event.server) {
        trayService.setConnected(event.server.name, event.server.ping ?? null);
        const connectedAt =
          deps.connectionMonitorService.getStatus().lastConnectionTime ??
          Date.now();
        deps.trafficStatsService.start(connectedAt);
      }
      if (eventName === 'disconnected') {
        trayService.setDisconnected();
        deps.trafficStatsService.stop();
      }
      if (eventName === 'error') {
        const message =
          (event as { error?: string; message?: string }).error ??
          (event as { message?: string }).message ??
          '';
        if (message) {
          trayService.reportError(message);
        }
      }
      if (eventName === 'switching') {
        trayService.reportSwitching();
      }
    });
  }
}
