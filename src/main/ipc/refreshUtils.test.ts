import { describe, expect, it } from 'vitest';
import type { ConnectionMonitorStatus } from '../../shared/ipc';
import { preserveActiveServerIfNeeded } from './refreshUtils';
import { makeServer } from '../../test/factories';

const activeServer = makeServer({
  uuid: 'active-server',
  address: 'active.example.com',
  name: 'Active Server',
});
const newServer = makeServer({
  uuid: 'new-server',
  address: 'new.example.com',
  name: 'New Server',
});

function makeMonitorStatus(overrides: Partial<ConnectionMonitorStatus> = {}): ConnectionMonitorStatus {
  return {
    isConnected: true,
    currentServer: activeServer,
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

describe('preserveActiveServerIfNeeded', () => {
  it.each([
    {
      monitorStatus: makeMonitorStatus(),
      isRunning: true,
      expectedUuids: [activeServer.uuid, newServer.uuid],
    },
    {
      monitorStatus: makeMonitorStatus({ isConnected: false }),
      isRunning: false,
      expectedUuids: [newServer.uuid],
    },
  ])('returns the expected refresh result for connection state %#', ({ monitorStatus, isRunning, expectedUuids }) => {
    const result = preserveActiveServerIfNeeded([newServer], [activeServer], monitorStatus, isRunning);

    expect(result.map((server) => server.uuid)).toEqual(expectedUuids);
  });
});
