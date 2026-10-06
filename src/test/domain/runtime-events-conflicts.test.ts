import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { registerRuntimeEvents } from '@/main/runtime/registerRuntimeEvents';

vi.mock('@/main/services/TrayService', () => ({
  trayService: {
    setConnecting: vi.fn(),
    reportSwitching: vi.fn(),
    setConnected: vi.fn(),
    setDisconnected: vi.fn(),
    reportError: vi.fn(),
  },
}));

function emitter<T extends object>(extra: T): EventEmitter & T {
  return Object.assign(new EventEmitter(), extra);
}

function setup(mode: 'proxy' | 'tun') {
  const deps = {
    xrayService: emitter({ getActivePorts: () => undefined }),
    connectionManager: emitter({
      getConnectionState: () => ({ type: 'disconnected' }),
      isBusy: () => false,
      handleRuntimeFailure: vi.fn(),
      handleHealthFailure: vi.fn(),
    }),
    connectionMonitorService: emitter({}),
    appRecoveryService: emitter({}),
    conflictingAppsService: emitter({ startTunCheck: vi.fn() }),
    pingRefresh: emitter({ handleSessionPhase: vi.fn() }),
    trafficStatsService: emitter({ start: vi.fn(), stop: vi.fn() }),
    appUpdaterService: emitter({ setConnectionBusyGetter: vi.fn() }),
    configService: { getConnectionMode: vi.fn(() => mode) },
    serverRepository: { get: vi.fn(() => null) },
  };
  const snapshotPublisher = { push: vi.fn() };
  registerRuntimeEvents({
    deps: deps as any,
    snapshotPublisher: snapshotPublisher as any,
    recovery: {} as any,
    sendToRenderer: vi.fn(),
  });
  return { deps, snapshotPublisher };
}

describe('TUN conflict check wiring', () => {
  it('checks on every TUN connect attempt and failure, whatever the renderer saw', () => {
    const { deps } = setup('tun');
    const { connectionManager, conflictingAppsService } = deps;

    // A fast connect → failed collapses into one renderer snapshot; main
    // still sees both phases.
    for (const phase of [
      'connecting',
      'failed',
      'connecting',
      'connected',
      'disconnecting',
      'idle',
      'connecting',
    ]) {
      connectionManager.emit('phase-changed', phase);
    }

    expect(conflictingAppsService.startTunCheck).toHaveBeenCalledTimes(4);
  });

  it('leaves proxy mode alone', () => {
    const { deps } = setup('proxy');
    deps.connectionManager.emit('phase-changed', 'connecting');
    deps.connectionManager.emit('phase-changed', 'failed');
    expect(deps.conflictingAppsService.startTunCheck).not.toHaveBeenCalled();
  });

  it('republishes the snapshot whenever the check changes', () => {
    const { deps, snapshotPublisher } = setup('tun');
    deps.conflictingAppsService.emit('tun-check-changed');
    expect(snapshotPublisher.push).toHaveBeenCalledWith('conflicts');
  });
});
