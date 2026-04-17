import { ConnectionMonitorStatus, AppRecoveryStatus, XrayHealthStatus } from '@/shared/ipc';
import { ConnectionStatus } from '@/main/services/ConnectionMonitorService';
import { VlessConfig } from '@/shared/types';

function stripRawConfig(server: VlessConfig | null): VlessConfig | null {
  if (!server) return server;
  const { rawConfig: _rawConfig, ...rest } = server;
  return rest as VlessConfig;
}

export function buildConnectionMonitorStatusSummary(
  status: ConnectionStatus,
  autoSwitchingEnabled: boolean,
  xrayHealth: XrayHealthStatus,
  recoveryStatus: AppRecoveryStatus
): ConnectionMonitorStatus {
  return {
    ...status,
    currentServer: stripRawConfig(status.currentServer),
    autoSwitchingEnabled,
    lastHealthCheckAt: status.lastHealthCheckAt,
    lastHealthState: status.lastHealthState,
    lastHealthFailureReason: status.lastHealthFailureReason,
    localProxyReachable: status.localProxyReachable,
    xrayState: xrayHealth.state,
    xrayReady: xrayHealth.ready,
    xrayRunning: xrayHealth.xrayRunning,
    xrayLastStartAt: xrayHealth.lastStartAt,
    xrayLastReadyAt: xrayHealth.lastReadyAt,
    xrayLastReadinessCheckAt: xrayHealth.lastReadinessCheckAt,
    xrayLocalProxyReachable: xrayHealth.localProxyReachable,
    xrayLastFailureAt: xrayHealth.lastFailureAt,
    xrayLastFailureReason: xrayHealth.lastFailureReason,
    xrayLastReadinessError: xrayHealth.lastReadinessError,
    recoveryInProgress: recoveryStatus.recoveryInProgress,
    recoveryAttemptCount: recoveryStatus.recoveryAttemptCount,
    recoveryBlocked: recoveryStatus.recoveryBlocked,
    lastRecoveryAt: recoveryStatus.lastRecoveryAt,
    lastRecoveryTrigger: recoveryStatus.lastRecoveryTrigger,
    lastRecoveryOutcome: recoveryStatus.lastRecoveryOutcome,
    lastRecoveryReason: recoveryStatus.lastRecoveryReason,
    lastFatalReason: recoveryStatus.lastFatalReason,
  };
}
