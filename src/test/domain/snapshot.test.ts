import { describe, expect, it, vi } from 'vitest';
import { buildAppSnapshot } from '@/main/ipc/appSnapshot';
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

describe('app snapshot owners', () => {
  it('projects a safe renderer snapshot from named owners', () => {
    const snapshot = buildAppSnapshot(createDeps() as any);

    expect(snapshot.selectedServerId).toBe('server-1');
    expect(snapshot.session.phase).toBe('connected');
    expect(snapshot.session.activeServerId).toBe('server-1');
    expect(snapshot.health.lastHealthState).toBe('healthy');
    expect(snapshot.servers).toHaveLength(1);
    expect('rawConfig' in snapshot.servers[0]).toBe(false);
  });

  it('session phase and lastError come from ConnectionState, not probe facts', () => {
    const snapshot = buildAppSnapshot(
      createDeps({
        connectionMonitorService: {
          getStatus: vi.fn(() => ({
            probeArmed: false,
            currentServer: null,
            lastError: 'stale monitor error',
            lastHealthState: 'failed',
            lastHealthFailureReason: 'probe failed',
            lastHealthCheckAt: 1,
            localProxyReachable: false,
          })),
        },
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
    expect(snapshot.health.lastHealthFailureReason).toBe('probe failed');
  });

  it('does not project probe lastError into an idle session', () => {
    const snapshot = buildAppSnapshot(
      createDeps({
        connectionMonitorService: {
          getStatus: vi.fn(() => ({
            probeArmed: false,
            currentServer: null,
            lastError: 'stale monitor error',
            lastHealthState: 'idle',
            lastHealthFailureReason: null,
            lastHealthCheckAt: null,
            localProxyReachable: null,
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

  it('keeps in-flight session phase even when probes still look connected', () => {
    const snapshot = buildAppSnapshot(
      createDeps({
        connectionMonitorService: {
          getStatus: vi.fn(() => ({
            probeArmed: true,
            currentServer: makeServer({ uuid: 'monitor-server' }),
            lastHealthState: 'healthy',
            lastHealthFailureReason: null,
            lastHealthCheckAt: null,
            localProxyReachable: true,
          })),
        },
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
    expect(snapshot.session.activeServerId).toBe('server-1');
  });

  it('projects activeServerId and blocked ids from the session, not the probe', () => {
    const snapshot = buildAppSnapshot(
      createDeps({
        connectionMonitorService: {
          getStatus: vi.fn(() => ({
            probeArmed: true,
            currentServer: makeServer({ uuid: 'monitor-server' }),
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
