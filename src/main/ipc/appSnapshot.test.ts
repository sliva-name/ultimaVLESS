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
      getPhase: vi.fn(() => 'connected'),
      isBusy: vi.fn(() => false),
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
    expect(snapshot.session.phase).toBe('connected');
    expect(snapshot.servers).toHaveLength(1);
    expect('rawConfig' in snapshot.servers[0]).toBe(false);
  });

  it('uses controller phase directly without monitor reconciliation', () => {
    const snapshot = buildAppSnapshot(
      createDeps({
        connectionMonitorService: {
          getStatus: vi.fn(() => ({
            isConnected: false,
            currentServer: null,
            lastError: null,
            blockedServers: [],
          })),
        },
        connectionController: {
          getPhase: vi.fn(() => 'disconnecting'),
          isBusy: vi.fn(() => true),
        },
      }) as any,
    );

    expect(snapshot.session.phase).toBe('disconnecting');
  });

  it('does not let monitor connected override an in-flight phase', () => {
    const snapshot = buildAppSnapshot(
      createDeps({
        connectionController: {
          getPhase: vi.fn(() => 'connecting'),
          isBusy: vi.fn(() => true),
        },
      }) as any,
    );

    expect(snapshot.session.phase).toBe('connecting');
  });
});
