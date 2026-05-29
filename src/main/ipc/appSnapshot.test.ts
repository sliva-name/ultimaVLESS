import { describe, expect, it, vi } from 'vitest';
import { buildAppSnapshot } from './appSnapshot';
import { makeServer, makeSubscription } from '@/test/factories';

function createDeps(overrides: Partial<any> = {}) {
  const server = makeServer({ uuid: 'server-1', rawConfig: { outbounds: [] } });
  return {
    configService: {
      getServers: vi.fn(() => [server]),
      getSubscriptions: vi.fn(() => [makeSubscription()]),
      getSelectedServerId: vi.fn(() => server.uuid),
      getConnectionMode: vi.fn(() => 'proxy'),
    },
    connectionMonitorService: {
      getStatus: vi.fn(() => ({
        isConnected: true,
        currentServer: server,
        lastError: null,
        blockedServers: [],
      })),
    },
    connectionController: {
      isBusy: vi.fn(() => false),
      getState: vi.fn(() => 'idle'),
    },
    trafficStatsService: {
      getLastSnapshot: vi.fn(() => null),
    },
    ...overrides,
  };
}

describe('buildAppSnapshot', () => {
  it('projects main runtime state into a safe renderer snapshot', () => {
    const snapshot = buildAppSnapshot(createDeps() as any);

    expect(snapshot.selectedServerId).toBe('server-1');
    expect(snapshot.session.status).toBe('connected');
    expect(snapshot.servers).toHaveLength(1);
    expect('rawConfig' in snapshot.servers[0]).toBe(false);
  });

  it('prefers controller state while a connection operation is active', () => {
    const snapshot = buildAppSnapshot(
      createDeps({
        connectionController: {
          isBusy: vi.fn(() => true),
          getState: vi.fn(() => 'switching'),
        },
      }) as any,
    );

    expect(snapshot.session.busy).toBe(true);
    expect(snapshot.session.status).toBe('switching');
  });
});
