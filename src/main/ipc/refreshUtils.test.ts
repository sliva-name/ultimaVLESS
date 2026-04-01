import { describe, expect, it } from 'vitest';
import type { ConnectionMonitorStatus } from '../../shared/ipc';
import type { VlessConfig } from '../../shared/types';
import { preserveActiveServerIfNeeded } from './refreshUtils';

const activeServer: VlessConfig = {
  uuid: 'active-server',
  address: 'active.example.com',
  port: 443,
  name: 'Active Server',
};

const newServer: VlessConfig = {
  uuid: 'new-server',
  address: 'new.example.com',
  port: 443,
  name: 'New Server',
};

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
  it('preserves the active server when refresh no longer contains it', () => {
    const result = preserveActiveServerIfNeeded(
      [newServer],
      [activeServer],
      makeMonitorStatus(),
      true
    );

    expect(result.map((server) => server.uuid)).toEqual([activeServer.uuid, newServer.uuid]);
  });

  it('does not modify refresh results when disconnected', () => {
    const result = preserveActiveServerIfNeeded(
      [newServer],
      [activeServer],
      makeMonitorStatus({ isConnected: false }),
      false
    );

    expect(result).toEqual([newServer]);
  });
});
