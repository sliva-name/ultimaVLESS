import type { ConnectionMonitorStatus, SaveSubscriptionPayload } from '../shared/ipc';
import type { VlessConfig } from '../shared/types';

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
  overrides: Partial<ConnectionMonitorStatus> = {}
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

export function makeSubscriptionPayload(
  overrides: Partial<SaveSubscriptionPayload> = {}
): SaveSubscriptionPayload {
  return {
    subscriptionUrl: 'https://example.com/subscription.txt',
    manualLinks: '',
    ...overrides,
  };
}
