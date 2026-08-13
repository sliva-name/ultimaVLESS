import { describe, expect, it, vi } from 'vitest';
import { IPC_EVENT_CHANNELS } from '@/shared/ipc';
import { SnapshotPublisher } from './SnapshotPublisher';
import { makeServer } from '@/test/factories';

function createDeps() {
  const server = makeServer();
  return {
    configService: {
      getSelectedServerId: vi.fn(() => server.uuid),
      getConnectionMode: vi.fn(() => 'proxy'),
    },
    serverRepository: {
      list: vi.fn(() => [server]),
    },
    subscriptionRepository: {
      list: vi.fn(() => []),
    },
    connectionMonitorService: {
      getStatus: vi.fn(() => ({
        isConnected: false,
        currentServer: null,
        lastError: null,
        blockedServers: [],
      })),
    },
    connectionController: {
      isBusy: vi.fn(() => false),
      getPhase: vi.fn(() => 'idle'),
    },
    trafficStatsService: {
      getLastSnapshot: vi.fn(() => null),
    },
  };
}

describe('SnapshotPublisher', () => {
  it('sends a full AppSnapshot to the renderer', () => {
    const send = vi.fn();
    const publisher = new SnapshotPublisher({
      deps: createDeps() as any,
      getWindow: () => ({ webContents: { send } }) as any,
    });

    publisher.push('manual');

    expect(send).toHaveBeenCalledWith(
      IPC_EVENT_CHANNELS.appSnapshotChanged,
      expect.objectContaining({
        servers: expect.any(Array),
        session: expect.objectContaining({ phase: 'idle' }),
      }),
    );
  });
});
