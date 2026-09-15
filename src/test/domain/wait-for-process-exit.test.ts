import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { waitForProcessExit } from '@/main/services/xray/waitForProcessExit';

function fakeProcess(overrides: { exitCode?: number | null } = {}) {
  const emitter = new EventEmitter();
  return {
    pid: 4242,
    exitCode: overrides.exitCode ?? null,
    signalCode: null,
    once: emitter.once.bind(emitter),
    off: emitter.off.bind(emitter),
    emit: emitter.emit.bind(emitter),
  };
}

describe('waitForProcessExit', () => {
  it('resolves immediately when the process has already exited', async () => {
    const kill = vi.fn();
    await waitForProcessExit(fakeProcess({ exitCode: 0 }), kill, {
      timeoutMs: 1_000,
    });
    expect(kill).not.toHaveBeenCalled();
  });

  it('resolves on close before the kill timeout', async () => {
    const child = fakeProcess();
    const kill = vi.fn();
    const pending = waitForProcessExit(child, kill, { timeoutMs: 5_000 });
    child.emit('close');
    await pending;
    expect(kill).not.toHaveBeenCalled();
  });

  it('kills and still resolves when close never fires', async () => {
    vi.useFakeTimers();
    try {
      const child = fakeProcess();
      const kill = vi.fn();
      const pending = waitForProcessExit(child, kill, {
        timeoutMs: 100,
        killGraceMs: 50,
      });

      await vi.advanceTimersByTimeAsync(100);
      expect(kill).toHaveBeenCalledTimes(1);

      const settled = vi.fn();
      void pending.then(settled);
      await vi.advanceTimersByTimeAsync(49);
      expect(settled).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(settled).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
