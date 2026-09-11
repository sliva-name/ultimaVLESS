import { describe, expect, it, vi } from 'vitest';
import { IPC_EVENT_CHANNELS } from '@/shared/ipc';
import { SnapshotPublisher } from '@/main/runtime/SnapshotPublisher';
import {
  makeAppRecoveryStatus,
  makeServer,
  makeSubscription,
  makeXrayHealthStatus,
} from '@/test/factories';

function createPublisherDeps(overrides: Partial<any> = {}) {
  const server = makeServer({ uuid: 'server-1' });
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
        lastHealthState: 'healthy',
        lastHealthFailureReason: null,
        lastHealthCheckAt: null,
        localProxyReachable: true,
      })),
    },
    connectionManager: {
      getPhase: vi.fn(() => 'connected'),
      getConnectionState: vi.fn(() => ({
        type: 'connected',
        serverId: server.uuid,
        mode: 'proxy',
      })),
      getBlockedServerIds: vi.fn(() => []),
      getAutoSwitchingEnabled: vi.fn(() => true),
    },
    xrayService: {
      getHealthStatus: vi.fn(() => makeXrayHealthStatus({ state: 'running' })),
    },
    appRecoveryService: {
      getStatus: vi.fn(() => makeAppRecoveryStatus()),
    },
    trafficStatsService: {
      getLastSnapshot: vi.fn(() => ({
        uploadBytes: 10,
        downloadBytes: 20,
        uploadBps: 1,
        downloadBps: 2,
        sessionDurationMs: 1000,
        connectedAt: 1,
        sampledAt: 2,
      })),
    },
    pingRefresh: {
      isRunning: vi.fn(() => false),
    },
    ...overrides,
  };
}

describe('SnapshotPublisher', () => {
  it('coalesces traffic/process ticks into a narrow patch without listing servers', () => {
    vi.useFakeTimers();
    const deps = createPublisherDeps();
    const send = vi.fn();
    const publisher = new SnapshotPublisher({
      deps: deps as any,
      getWindow: () => ({ webContents: { send } }) as any,
    });

    publisher.push('traffic');
    publisher.push('process');
    expect(send).not.toHaveBeenCalled();

    vi.advanceTimersByTime(75);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(IPC_EVENT_CHANNELS.appSnapshotPatch, {
      traffic: deps.trafficStatsService.getLastSnapshot(),
      process: deps.xrayService.getHealthStatus(),
    });
    expect(deps.serverRepository.list).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('sends a full snapshot when a catalog reason is mixed in', () => {
    vi.useFakeTimers();
    const deps = createPublisherDeps();
    const send = vi.fn();
    const publisher = new SnapshotPublisher({
      deps: deps as any,
      getWindow: () => ({ webContents: { send } }) as any,
    });

    publisher.push('traffic');
    publisher.push('ping');
    vi.advanceTimersByTime(75);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe(IPC_EVENT_CHANNELS.appSnapshotChanged);
    expect(send.mock.calls[0][1].servers).toHaveLength(1);
    expect(deps.serverRepository.list).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('flushes immediately when asked and reuses a cached catalog slice', () => {
    const deps = createPublisherDeps();
    const send = vi.fn();
    const publisher = new SnapshotPublisher({
      deps: deps as any,
      getWindow: () => ({ webContents: { send } }) as any,
    });

    publisher.push('connection', { immediate: true });
    publisher.push('settings', { immediate: true });

    expect(send).toHaveBeenCalledTimes(2);
    expect(deps.serverRepository.list).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][1].servers).toBe(send.mock.calls[1][1].servers);
  });
});
