import type { VlessConfig } from '@/shared/types';

export interface ConnectionMonitorEvent {
  type: 'connected' | 'disconnected' | 'error' | 'blocked' | 'switching';
  server: VlessConfig | null;
  error?: string;
  message?: string;
}

export type XrayHealthState =
  | 'starting'
  | 'running'
  | 'degraded'
  | 'stopping'
  | 'stopped'
  | 'failed';

export type ConnectionHealthState = 'idle' | 'healthy' | 'degraded' | 'failed';

export type AppRecoveryTrigger =
  | 'initial-load'
  | 'did-fail-load'
  | 'render-process-gone'
  | 'unresponsive'
  | 'child-process-gone'
  | 'uncaught-exception'
  | 'unhandled-rejection';

export type AppRecoveryOutcome =
  | 'reloaded'
  | 'recreated'
  | 'completed'
  | 'blocked'
  | 'fatal-exit-needed';

export interface XrayHealthStatus {
  state: XrayHealthState;
  ready: boolean;
  xrayRunning: boolean;
  lastStartAt: number | null;
  lastReadyAt: number | null;
  lastReadinessCheckAt: number | null;
  localProxyReachable: boolean | null;
  lastFailureAt: number | null;
  lastFailureReason: string | null;
  lastReadinessError: string | null;
}

export interface AppRecoveryStatus {
  recoveryInProgress: boolean;
  recoveryAttemptCount: number;
  recoveryBlocked: boolean;
  lastRecoveryAt: number | null;
  lastRecoveryTrigger: AppRecoveryTrigger | null;
  lastRecoveryOutcome: AppRecoveryOutcome | null;
  lastRecoveryReason: string | null;
  lastFatalReason: string | null;
}

export interface ConnectionMonitorStatus {
  isConnected: boolean;
  currentServer: VlessConfig | null;
  lastError: string | null;
  connectionAttempts: number;
  lastConnectionTime: number | null;
  blockedServers: string[];
  autoSwitchingEnabled: boolean;
  lastHealthCheckAt: number | null;
  lastHealthState: ConnectionHealthState;
  lastHealthFailureReason: string | null;
  localProxyReachable: boolean | null;
  xrayState: XrayHealthState;
  xrayReady: boolean;
  xrayRunning: boolean;
  xrayLastStartAt: number | null;
  xrayLastReadyAt: number | null;
  xrayLastReadinessCheckAt: number | null;
  xrayLocalProxyReachable: boolean | null;
  xrayLastFailureAt: number | null;
  xrayLastFailureReason: string | null;
  xrayLastReadinessError: string | null;
  recoveryInProgress: boolean;
  recoveryAttemptCount: number;
  recoveryBlocked: boolean;
  lastRecoveryAt: number | null;
  lastRecoveryTrigger: AppRecoveryTrigger | null;
  lastRecoveryOutcome: AppRecoveryOutcome | null;
  lastRecoveryReason: string | null;
  lastFatalReason: string | null;
}

export interface TunCapabilityStatus {
  platform: string;
  supported: boolean;
  hasPrivileges: boolean;
  privilegeHint: string | null;
  unsupportedReason: string | null;
  routeMode: string | null;
  degradedReason: string | null;
}
