import type {
  AppRecoveryStatus,
  AppSnapshot,
  ConnectionMonitorStatus,
  XrayHealthStatus,
} from '@/shared/ipc';
import type { Subscription, VlessConfig } from '@/shared/types';

export function makeServer(overrides: Partial<VlessConfig> = {}): VlessConfig {
  const uuid = overrides.uuid ?? 'server-1';
  return {
    uuid,
    address: 'example.com',
    port: 443,
    name: `Server ${uuid}`,
    ...overrides,
  };
}

export function makeMonitorStatus(
  overrides: Partial<ConnectionMonitorStatus> = {},
): ConnectionMonitorStatus {
  return {
    isConnected: false,
    currentServer: null,
    lastError: null,
    connectionAttempts: 0,
    lastConnectionTime: null,
    blockedServers: [],
    autoSwitchingEnabled: true,
    lastHealthCheckAt: null,
    lastHealthState: 'idle',
    lastHealthFailureReason: null,
    localProxyReachable: null,
    xrayState: 'stopped',
    xrayReady: false,
    xrayRunning: false,
    xrayLastStartAt: null,
    xrayLastReadyAt: null,
    xrayLastReadinessCheckAt: null,
    xrayLocalProxyReachable: null,
    xrayLastFailureAt: null,
    xrayLastFailureReason: null,
    xrayLastReadinessError: null,
    recoveryInProgress: false,
    recoveryAttemptCount: 0,
    recoveryBlocked: false,
    lastRecoveryAt: null,
    lastRecoveryTrigger: null,
    lastRecoveryOutcome: null,
    lastRecoveryReason: null,
    lastFatalReason: null,
    ...overrides,
  };
}

export function makeSubscription(
  overrides: Partial<Subscription> = {},
): Subscription {
  return {
    id: 'sub-1',
    name: 'Test Subscription',
    url: 'https://example.com/sub',
    enabled: true,
    ...overrides,
  };
}

export function makeAppSnapshot(
  overrides: Partial<AppSnapshot> = {},
): AppSnapshot {
  return {
    servers: [],
    subscriptions: [],
    selectedServerId: null,
    connectionMode: 'proxy',
    session: {
      phase: 'idle',
      activeServerId: null,
      lastError: null,
      blockedServerIds: [],
    },
    health: {
      lastHealthState: 'idle',
      lastHealthFailureReason: null,
      lastHealthCheckAt: null,
      localProxyReachable: null,
    },
    process: makeXrayHealthStatus(),
    recovery: makeAppRecoveryStatus(),
    autoSwitchingEnabled: true,
    traffic: null,
    ...overrides,
  };
}

export function makeXrayHealthStatus(
  overrides: Partial<XrayHealthStatus> = {},
): XrayHealthStatus {
  return {
    state: 'stopped',
    ready: false,
    xrayRunning: false,
    lastStartAt: null,
    lastReadyAt: null,
    lastReadinessCheckAt: null,
    localProxyReachable: null,
    lastFailureAt: null,
    lastFailureReason: null,
    lastReadinessError: null,
    ...overrides,
  };
}

export function makeAppRecoveryStatus(
  overrides: Partial<AppRecoveryStatus> = {},
): AppRecoveryStatus {
  return {
    recoveryInProgress: false,
    recoveryAttemptCount: 0,
    recoveryBlocked: false,
    lastRecoveryAt: null,
    lastRecoveryTrigger: null,
    lastRecoveryOutcome: null,
    lastRecoveryReason: null,
    lastFatalReason: null,
    ...overrides,
  };
}
