import { describe, expect, it, vi } from 'vitest';
import { buildAppSnapshot } from './appSnapshot';
import {
  makeAppRecoveryStatus,
  makeServer,
  makeSubscription,
  makeXrayHealthStatus,
} from '@/test/factories';

function createDeps(overrides: Partial<any> = {}) {
  const server = makeServer({ uuid: 'server-1', rawConfig: { outbounds: [] } });
  return {
    configService: {
      getSelectedServerId: vi.fn(() => server.uuid),
      getConnectionMode: vi.fn(() => 'proxy'),
    },
    serverRepository: {
      list: vi.fn(() => [server]),
    },
    subscriptionRepository: {
      list: vi.fn(() => [makeSubscription()]),
    },
    connectionMonitorService: {
      getStatus: vi.fn(() => ({
        probeArmed: true,
        currentServer: server,
        lastHealthState: 'healthy',
        lastHealthFailureReason: null,
        lastHealthCheckAt: null,
        localProxyReachable: true,
      })),
    },
    connectionController: {
      getPhase: vi.fn(() => 'connected'),
      getConnectionState: vi.fn(() => ({
        type: 'connected',
        serverId: server.uuid,
        mode: 'proxy',
      })),
      isBusy: vi.fn(() => false),
      getBlockedServerIds: vi.fn(() => []),
      getAutoSwitchingEnabled: vi.fn(() => true),
    },
    xrayService: {
      getHealthStatus: vi.fn(() => makeXrayHealthStatus()),
    },
    appRecoveryService: {
      getStatus: vi.fn(() => makeAppRecoveryStatus()),
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
          getConnectionState: vi.fn(() => ({
            type: 'stopping',
            generation: 1,
            outcome: 'idle',
          })),
          isBusy: vi.fn(() => true),
          getBlockedServerIds: vi.fn(() => []),
          getAutoSwitchingEnabled: vi.fn(() => true),
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
          getConnectionState: vi.fn(() => ({
            type: 'starting',
            serverId: 'server-1',
            mode: 'proxy',
            generation: 1,
          })),
          isBusy: vi.fn(() => true),
          getBlockedServerIds: vi.fn(() => []),
          getAutoSwitchingEnabled: vi.fn(() => true),
        },
      }) as any,
    );

    expect(snapshot.session.phase).toBe('connecting');
  });

  it('projects the controller failure reason when the monitor has no lastError', () => {
    const snapshot = buildAppSnapshot(
      createDeps({
        connectionController: {
          getPhase: vi.fn(() => 'failed'),
          getConnectionState: vi.fn(() => ({
            type: 'failed',
            reason: { message: 'spawn failed' },
          })),
          isBusy: vi.fn(() => false),
          getBlockedServerIds: vi.fn(() => []),
          getAutoSwitchingEnabled: vi.fn(() => true),
        },
      }) as any,
    );

    expect(snapshot.session.phase).toBe('failed');
    expect(snapshot.session.lastError).toBe('spawn failed');
  });

  it('does not project monitor lastError into the session snapshot', () => {
    const snapshot = buildAppSnapshot(
      createDeps({
        connectionMonitorService: {
          getStatus: vi.fn(() => ({
            isConnected: false,
            currentServer: null,
            lastError: 'stale monitor error',
            blockedServers: [],
          })),
        },
        connectionController: {
          getPhase: vi.fn(() => 'idle'),
          getConnectionState: vi.fn(() => ({ type: 'disconnected' })),
          isBusy: vi.fn(() => false),
          getBlockedServerIds: vi.fn(() => []),
          getAutoSwitchingEnabled: vi.fn(() => true),
        },
      }) as any,
    );

    expect(snapshot.session.lastError).toBeNull();
  });

  it('projects activeServerId from the controller, not the monitor', () => {
    const snapshot = buildAppSnapshot(
      createDeps({
        connectionMonitorService: {
          getStatus: vi.fn(() => ({
            isConnected: true,
            currentServer: makeServer({ uuid: 'monitor-server' }),
            lastError: null,
            blockedServers: ['blocked-1'],
          })),
        },
        connectionController: {
          getPhase: vi.fn(() => 'connected'),
          getConnectionState: vi.fn(() => ({
            type: 'connected',
            serverId: 'controller-server',
            mode: 'proxy',
          })),
          isBusy: vi.fn(() => false),
          getBlockedServerIds: vi.fn(() => ['blocked-1']),
          getAutoSwitchingEnabled: vi.fn(() => true),
        },
      }) as any,
    );

    expect(snapshot.session.activeServerId).toBe('controller-server');
    expect(snapshot.session.blockedServerIds).toEqual(['blocked-1']);
  });
});
