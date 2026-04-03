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
