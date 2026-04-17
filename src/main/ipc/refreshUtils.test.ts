import { describe, expect, it } from 'vitest';
import type { ConnectionMonitorStatus } from '@/shared/ipc';
import { preserveActiveServerIfNeeded } from './refreshUtils';
import { makeServer } from '@/test/factories';

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
    const result = preserveActiveServerIfNeeded([newServer], [activeServer], monitorStatus, isRunning, null);

    expect(result.map((server) => server.uuid)).toEqual(expectedUuids);
  });

  it('does not duplicate the active server when the subscription rotated its uuid', () => {
    const active = makeServer({
      uuid: 'stable-old',
      address: 'same.example.com',
      port: 443,
      protocol: 'vless',
      userId: 'token-old',
      name: 'Rotated Server',
    });
    const rotated = makeServer({
      uuid: 'stable-new',
      address: 'same.example.com',
      port: 443,
      protocol: 'vless',
      userId: 'token-new',
      name: 'Rotated Server',
    });

    const result = preserveActiveServerIfNeeded([rotated], [active], makeMonitorStatus({ currentServer: active }), true, null);

    expect(result.map((server) => server.uuid)).toEqual(['stable-new']);
  });

  it('does not preserve the selected server twice when its uuid rotated', () => {
    const previouslySelected = makeServer({
      uuid: 'sel-old',
      address: 'endpoint.example.com',
      port: 443,
      userId: 'rotating-token-old',
    });
    const refreshed = makeServer({
      uuid: 'sel-new',
      address: 'endpoint.example.com',
      port: 443,
      userId: 'rotating-token-new',
    });

    const result = preserveActiveServerIfNeeded(
      [refreshed],
      [previouslySelected],
      makeMonitorStatus({ isConnected: false, currentServer: null }),
      false,
      previouslySelected.uuid
    );

    expect(result.map((server) => server.uuid)).toEqual(['sel-new']);
  });
});
