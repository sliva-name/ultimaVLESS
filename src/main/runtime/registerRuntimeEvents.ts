import type { VlessConfig } from '@/shared/types';
import { toSafeServer } from '@/shared/serverView';
import { activeServerIdFromState } from '@/main/domain/connection/ConnectionState';
import type { SessionPhase } from '@/shared/ipc';
import { IPC_EVENT_CHANNELS, type IpcEventChannel } from '@/shared/ipc';
import { trayService } from '@/main/services/TrayService';
import type { IpcDependencies } from '@/main/ipc/dependencies';
import type { SnapshotPublisher } from './SnapshotPublisher';
import type { ConnectionRecovery } from './ConnectionRecovery';
import type { HealthFailureEvent } from '@/main/services/ConnectionMonitorService';
import { logger } from '@/main/services/LoggerService';

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
    const serverId = activeServerIdFromState(
      deps.connectionController.getConnectionState(),
    );
    const server = serverId ? deps.serverRepository.get(serverId) : null;
    if (!server) return;
    trayService.setConnected(server.name, server.ping ?? null);
    deps.trafficStatsService.start(
      Date.now(),
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
    if (healthStatus.state !== 'failed') {
      return;
    }
    const reason =
      healthStatus.lastFailureReason ||
      healthStatus.lastReadinessError ||
      'Xray reported failed health status';
    void Promise.resolve(
      deps.connectionController.handleRuntimeFailure(reason, {
        localProxyReachable: healthStatus.localProxyReachable,
      }),
    ).catch((error) => {
      logger.error('Runtime', 'Failed to handle Xray health failure', error);
    });
  });

  deps.connectionMonitorService.removeAllListeners('health-failure');
  deps.connectionMonitorService.on(
    'health-failure',
    (event: HealthFailureEvent) => {
      void Promise.resolve(
        deps.connectionController.handleHealthFailure(event),
      ).catch((error) => {
        logger.error('Runtime', 'Failed to handle health failure', error);
      });
    },
  );

  deps.connectionController.removeAllListeners('phase-changed');
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
        safeEvent.server = toSafeServer(safeEvent.server) as VlessConfig;
      }
      sendToRenderer(IPC_EVENT_CHANNELS.connectionMonitorEvent, safeEvent);
      if (eventName === 'blocked') {
        snapshotPublisher.push('monitor');
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
    });
  }
}
