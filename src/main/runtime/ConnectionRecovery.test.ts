import { describe, expect, it, vi } from 'vitest';
import { createConnectionRecovery } from './ConnectionRecovery';
import { makeServer } from '@/test/factories';

describe('ConnectionRecovery', () => {
  it('turns unexpected Xray exits into monitor failures and cleanup', async () => {
    const server = makeServer({ uuid: 'active-server' });
    const snapshotPublisher = { push: vi.fn() };
    const deps = {
      connectionMonitorService: {
        getStatus: vi.fn(() => ({ isConnected: true, currentServer: server })),
        handleCriticalConnectionFailure: vi.fn(() => false),
        handleUnexpectedDisconnect: vi.fn(),
      },
      connectionController: {
        cleanupAfterFailure: vi.fn(async () => undefined),
      },
    };

    await createConnectionRecovery(
      deps as any,
      snapshotPublisher as any,
    ).handleUnexpectedXrayExit('process exited');

    expect(
      deps.connectionMonitorService.handleCriticalConnectionFailure,
    ).toHaveBeenCalledWith(
      'Connection lost: process exited',
      expect.objectContaining({ localProxyReachable: false }),
    );
    expect(
      deps.connectionMonitorService.handleUnexpectedDisconnect,
    ).toHaveBeenCalled();
    expect(deps.connectionController.cleanupAfterFailure).toHaveBeenCalled();
    expect(snapshotPublisher.push).toHaveBeenCalledWith('recovery');
  });

  it('leaves the runtime alone when auto-switch is scheduled', async () => {
    const server = makeServer({ uuid: 'active-server' });
    const snapshotPublisher = { push: vi.fn() };
    const deps = {
      connectionMonitorService: {
        getStatus: vi.fn(() => ({ isConnected: true, currentServer: server })),
        handleCriticalConnectionFailure: vi.fn(() => true),
        handleUnexpectedDisconnect: vi.fn(),
      },
      connectionController: {
        cleanupAfterFailure: vi.fn(async () => undefined),
      },
    };

    await createConnectionRecovery(
      deps as any,
      snapshotPublisher as any,
    ).handleUnexpectedXrayExit('process exited');

    expect(
      deps.connectionMonitorService.handleUnexpectedDisconnect,
    ).not.toHaveBeenCalled();
    expect(
      deps.connectionController.cleanupAfterFailure,
    ).not.toHaveBeenCalled();
    expect(snapshotPublisher.push).toHaveBeenCalledWith('recovery');
  });

  it('records pending TUN reconnect failures when requested', async () => {
    const snapshotPublisher = { push: vi.fn() };
    const deps = {
      connectionController: {
        resumePendingTun: vi.fn(async () => {
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
    ).attemptPendingTunReconnect('server-1', { emitErrorOnFailure: true });

    expect(result).toBe(false);
    expect(deps.connectionMonitorService.recordError).toHaveBeenCalledWith(
      'no privileges',
    );
    expect(snapshotPublisher.push).toHaveBeenCalledWith('recovery');
  });
});
