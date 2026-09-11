import { describe, expect, it, vi } from 'vitest';
import { AppLifecycle } from '@/main/runtime/appLifecycle';
import { StartupRecoveryCoordinator } from '@/main/runtime/startupRecovery';
import { isElevatedRelaunch } from '@/main/runtime/launchArgs';
import { RELAUNCH_ARG } from '@/shared/constants';

describe('AppLifecycle', () => {
  it('records the reason, notifies listeners, then quits', () => {
    const quitApp = vi.fn();
    const lifecycle = new AppLifecycle(quitApp);
    const order: string[] = [];
    lifecycle.on('quit-requested', (reason) => {
      order.push(`listener:${reason}`);
      expect(lifecycle.quitReason).toBe('elevated-relaunch');
      expect(quitApp).not.toHaveBeenCalled();
    });
    quitApp.mockImplementation(() => order.push('quit'));

    lifecycle.requestQuit('elevated-relaunch');

    expect(order).toEqual(['listener:elevated-relaunch', 'quit']);
    expect(lifecycle.isRelaunchingElevated).toBe(true);
  });

  it('keeps the first reason when quit is requested again', () => {
    const quitApp = vi.fn();
    const lifecycle = new AppLifecycle(quitApp);
    const listener = vi.fn();
    lifecycle.on('quit-requested', listener);

    lifecycle.requestQuit('elevated-relaunch');
    lifecycle.requestQuit('user');

    expect(lifecycle.quitReason).toBe('elevated-relaunch');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(quitApp).toHaveBeenCalledTimes(1);
  });

  it('noteExternalQuit only fills in a missing reason', () => {
    const lifecycle = new AppLifecycle(vi.fn());

    lifecycle.noteExternalQuit('update');
    lifecycle.noteExternalQuit('user');

    expect(lifecycle.quitReason).toBe('update');
    expect(lifecycle.isRelaunchingElevated).toBe(false);
  });
});

describe('StartupRecoveryCoordinator', () => {
  it('lets callers through immediately before recovery has started', async () => {
    const coordinator = new StartupRecoveryCoordinator();
    await expect(coordinator.awaitNetworkRecovery()).resolves.toBeUndefined();
    expect(coordinator.isRunning).toBe(false);
  });

  it('blocks the gate while recovery runs and runs the work only once', async () => {
    const coordinator = new StartupRecoveryCoordinator();
    let finish: () => void = () => undefined;
    const work = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    void coordinator.run(work);
    void coordinator.run(work);
    let gateOpened = false;
    const waiter = coordinator.awaitNetworkRecovery().then(() => {
      gateOpened = true;
    });
    await Promise.resolve();
    expect(gateOpened).toBe(false);
    expect(work).toHaveBeenCalledTimes(1);

    finish();
    await waiter;
    expect(gateOpened).toBe(true);
  });

  it('never rejects the gate when recovery fails', async () => {
    const coordinator = new StartupRecoveryCoordinator();

    await coordinator.run(async () => {
      throw new Error('powershell exploded');
    });

    await expect(coordinator.awaitNetworkRecovery()).resolves.toBeUndefined();
  });
});

describe('isElevatedRelaunch', () => {
  it('detects the relaunch marker in argv', () => {
    expect(isElevatedRelaunch(['app.exe', RELAUNCH_ARG])).toBe(true);
    expect(isElevatedRelaunch(['app.exe', '--other'])).toBe(false);
  });
});
