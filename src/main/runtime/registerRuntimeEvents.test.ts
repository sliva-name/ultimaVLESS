import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { IPC_EVENT_CHANNELS } from '@/shared/ipc';
import { makeServer } from '@/test/factories';
import { registerRuntimeEvents } from './registerRuntimeEvents';

vi.mock('@/main/services/TrayService', () => ({
  trayService: {
    setConnected: vi.fn(),
    setDisconnected: vi.fn(),
    reportError: vi.fn(),
    reportSwitching: vi.fn(),
  },
}));

describe('registerRuntimeEvents', () => {
  function createDeps() {
    return {
      xrayService: new EventEmitter(),
      connectionMonitorService: Object.assign(new EventEmitter(), {
        setSwitchExecutor: vi.fn(),
        setCleanupExecutor: vi.fn(),
        handleXrayHealthStatusChanged: vi.fn(),
        getStatus: vi.fn(() => ({ lastConnectionTime: 123 })),
      }),
      connectionController: Object.assign(new EventEmitter(), {
        transitionForAutoSwitch: vi.fn(),
        cleanupAfterFailure: vi.fn(),
        isBusy: vi.fn(() => false),
      }),
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
});
