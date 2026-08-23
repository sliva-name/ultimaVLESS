import { describe, expect, it, vi } from 'vitest';
import { createConnectionRecovery } from './ConnectionRecovery';
import { makeServer } from '@/test/factories';

describe('ConnectionRecovery', () => {
  it('delegates unexpected Xray exits to ConnectionManager', async () => {
    const server = makeServer({ uuid: 'active-server' });
    const snapshotPublisher = { push: vi.fn() };
    const deps = {
      connectionMonitorService: {
        getStatus: vi.fn(() => ({ isConnected: true, currentServer: server })),
      },
      connectionController: {
        getPhase: vi.fn(() => 'connected'),
        handleRuntimeFailure: vi.fn(async () => undefined),
        cleanupAfterFailure: vi.fn(async () => undefined),
      },
    };

    await createConnectionRecovery(
      deps as any,
      snapshotPublisher as any,
    ).handleUnexpectedXrayExit('process exited');

    expect(deps.connectionController.handleRuntimeFailure).toHaveBeenCalledWith(
      'Connection lost: process exited',
      expect.objectContaining({ localProxyReachable: false }),
    );
    expect(deps.connectionController.cleanupAfterFailure).not.toHaveBeenCalled();
    expect(snapshotPublisher.push).toHaveBeenCalledWith('recovery');
  });

  it('records pending TUN reconnect failures when requested', async () => {
    const snapshotPublisher = { push: vi.fn() };
    const deps = {
      connectionController: {
        resumePendingTunAfterRelaunch: vi.fn(async () => {
          throw new Error('no privileges');
        }),
        cleanupAfterFailure: vi.fn(async () => undefined),
      },
      connectionMonitorService: {
        recordError: vi.fn(),
      },
    };

    const result = await createConnectionRecovery(
      deps as any,
      snapshotPublisher as any,
    ).attemptPendingTunReconnect({ emitErrorOnFailure: true });

    expect(result).toBe(false);
    expect(deps.connectionController.cleanupAfterFailure).toHaveBeenCalledWith(
      'no privileges',
    );
    expect(snapshotPublisher.push).toHaveBeenCalledWith('recovery');
  });

  it('ignores unexpected Xray exits when the session is not live', async () => {
    const snapshotPublisher = { push: vi.fn() };
    const deps = {
      connectionController: {
        getPhase: vi.fn(() => 'idle'),
        handleRuntimeFailure: vi.fn(async () => undefined),
      },
    };

    await createConnectionRecovery(
      deps as any,
      snapshotPublisher as any,
    ).handleUnexpectedXrayExit('process exited');

    expect(
      deps.connectionController.handleRuntimeFailure,
    ).not.toHaveBeenCalled();
    expect(snapshotPublisher.push).not.toHaveBeenCalled();
  });
});
