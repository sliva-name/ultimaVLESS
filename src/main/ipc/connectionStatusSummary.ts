import {
  ConnectionMonitorStatus,
  type AppHealthSnapshot,
  type AppRecoveryStatus,
  type AppSessionSnapshot,
  type XrayHealthStatus,
} from '@/shared/ipc';
import { VlessConfig } from '@/shared/types';
import { toSafeServer } from '@/shared/serverView';

function stripRawConfig(server: VlessConfig | null): VlessConfig | null {
  if (!server) return server;
  return toSafeServer(server) as VlessConfig;
}

/**
 * Legacy flattened diagnostics DTO. Built from named owners — not a
 * monitor-owned mega-status.
 */
export function buildConnectionMonitorStatusSummary(input: {
  session: AppSessionSnapshot;
  health: AppHealthSnapshot;
  process: XrayHealthStatus;
  recovery: AppRecoveryStatus;
  autoSwitchingEnabled: boolean;
  currentServer: VlessConfig | null;
}): ConnectionMonitorStatus {
  const { session, health, process, recovery } = input;
  return {
    isConnected: session.phase === 'connected',
    currentServer: stripRawConfig(input.currentServer),
    lastError: session.lastError,
    connectionAttempts: 0,
    lastConnectionTime: null,
    blockedServers: session.blockedServerIds,
    autoSwitchingEnabled: input.autoSwitchingEnabled,
    lastHealthCheckAt: health.lastHealthCheckAt,
    lastHealthState: health.lastHealthState,
    lastHealthFailureReason: health.lastHealthFailureReason,
    localProxyReachable: health.localProxyReachable,
    xrayState: process.state,
    xrayReady: process.ready,
    xrayRunning: process.xrayRunning,
    xrayLastStartAt: process.lastStartAt,
    xrayLastReadyAt: process.lastReadyAt,
    xrayLastReadinessCheckAt: process.lastReadinessCheckAt,
    xrayLocalProxyReachable: process.localProxyReachable,
    xrayLastFailureAt: process.lastFailureAt,
    xrayLastFailureReason: process.lastFailureReason,
    xrayLastReadinessError: process.lastReadinessError,
    recoveryInProgress: recovery.recoveryInProgress,
    recoveryAttemptCount: recovery.recoveryAttemptCount,
    recoveryBlocked: recovery.recoveryBlocked,
    lastRecoveryAt: recovery.lastRecoveryAt,
    lastRecoveryTrigger: recovery.lastRecoveryTrigger,
    lastRecoveryOutcome: recovery.lastRecoveryOutcome,
    lastRecoveryReason: recovery.lastRecoveryReason,
    lastFatalReason: recovery.lastFatalReason,
  };
}
