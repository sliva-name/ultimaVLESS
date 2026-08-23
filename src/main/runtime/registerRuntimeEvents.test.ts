import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { IPC_EVENT_CHANNELS } from '@/shared/ipc';
import { makeServer } from '@/test/factories';
import { registerRuntimeEvents } from './registerRuntimeEvents';

vi.mock('@/main/services/TrayService', () => ({
  trayService: {
    setConnected: vi.fn(),
    setConnecting: vi.fn(),
    setDisconnected: vi.fn(),
    reportError: vi.fn(),
    reportSwitching: vi.fn(),
  },
}));

describe('registerRuntimeEvents', () => {
  function createDeps() {
    return {
      xrayService: Object.assign(new EventEmitter(), {
        getActivePorts: vi.fn(() => ({
          socks: 10808,
          http: 10809,
          api: 10810,
        })),
      }),
      connectionMonitorService: Object.assign(new EventEmitter(), {
        handleXrayHealthStatusChanged: vi.fn(),
        getStatus: vi.fn(() => ({
          isConnected: true,
          currentServer: makeServer({ name: 'SE' }),
          lastConnectionTime: 123,
        })),
      }),
      connectionController: Object.assign(new EventEmitter(), {
        handleHealthFailure: vi.fn(),
        handleRuntimeFailure: vi.fn(),
        cleanupAfterFailure: vi.fn(),
        isBusy: vi.fn(() => false),
        getPhase: vi.fn(() => 'idle'),
        getConnectionState: vi.fn(() => ({
          type: 'connected',
          serverId: 'server-1',
          mode: 'proxy',
        })),
      }),
      serverRepository: {
        get: vi.fn(() => makeServer({ uuid: 'server-1', name: 'SE' })),
      },
      trafficStatsService: Object.assign(new EventEmitter(), {
        start: vi.fn(),
        stop: vi.fn(),
      }),
      appUpdaterService: Object.assign(new EventEmitter(), {
        setConnectionBusyGetter: vi.fn(),
      }),
    };
  }

  it('wires runtime events to snapshot publishing and renderer notifications', () => {
    const deps = createDeps();
    const snapshotPublisher = { push: vi.fn() };
    const recovery = { handleUnexpectedXrayExit: vi.fn() };
    const sendToRenderer = vi.fn();
    registerRuntimeEvents({
      deps: deps as any,
      snapshotPublisher: snapshotPublisher as any,
      recovery: recovery as any,
      sendToRenderer,
    });

    const server = makeServer();
    deps.connectionMonitorService.emit('connected', {
      type: 'connected',
      server,
    });
    deps.trafficStatsService.emit('snapshot', {});
    deps.appUpdaterService.emit('status', { stage: 'available' });

    expect(sendToRenderer).toHaveBeenCalledWith(
      IPC_EVENT_CHANNELS.connectionMonitorEvent,
      expect.objectContaining({ type: 'connected' }),
    );
    expect(sendToRenderer).toHaveBeenCalledWith(
      IPC_EVENT_CHANNELS.updateStatus,
      { stage: 'available' },
    );
    expect(snapshotPublisher.push).toHaveBeenCalledWith('monitor');
    expect(snapshotPublisher.push).toHaveBeenCalledWith('traffic');
  });

  it('drives tray from phase-changed, not monitor connected', async () => {
    const { trayService } = await import('@/main/services/TrayService');
    const deps = createDeps();
    registerRuntimeEvents({
      deps: deps as any,
      snapshotPublisher: { push: vi.fn() } as any,
      recovery: { handleUnexpectedXrayExit: vi.fn() } as any,
      sendToRenderer: vi.fn(),
    });

    deps.connectionMonitorService.emit('connected', {
      type: 'connected',
      server: makeServer({ name: 'SE' }),
    });
    expect(trayService.setConnected).not.toHaveBeenCalled();

    deps.connectionController.emit('phase-changed', 'connecting');
    expect(trayService.setConnecting).toHaveBeenCalled();

    deps.connectionController.emit('phase-changed', 'connected');
    expect(trayService.setConnected).toHaveBeenCalledWith('SE', null);
    expect(deps.trafficStatsService.start).toHaveBeenCalledWith(
      expect.any(Number),
      10810,
    );

    deps.connectionController.emit('phase-changed', 'idle');
    expect(trayService.setDisconnected).toHaveBeenCalled();
    expect(deps.trafficStatsService.stop).toHaveBeenCalled();
  });

  it('forwards health-failure events to ConnectionManager', () => {
    const deps = createDeps();
    registerRuntimeEvents({
      deps: deps as any,
      snapshotPublisher: { push: vi.fn() } as any,
      recovery: { handleUnexpectedXrayExit: vi.fn() } as any,
      sendToRenderer: vi.fn(),
    });

    const event = {
      server: makeServer(),
      reason: 'blocked',
      blocking: true,
    };
    deps.connectionMonitorService.emit('health-failure', event);
    expect(deps.connectionController.handleHealthFailure).toHaveBeenCalledWith(
      event,
    );
  });
});
