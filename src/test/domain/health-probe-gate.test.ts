import { describe, expect, it, vi } from 'vitest';
import { HealthCheckGate } from '@/main/runtime/healthCheckGate';

describe('HealthCheckGate', () => {
  it('runs the first request immediately', async () => {
    const gate = new HealthCheckGate();
    const run = vi.fn(async () => undefined);

    gate.request(run);
    await Promise.resolve();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('coalesces overlapping requests into one rerun', async () => {
    const gate = new HealthCheckGate();
    let release!: () => void;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(async () => undefined);

    gate.request(run);
    gate.request(run);
    gate.request(run);
    expect(run).toHaveBeenCalledTimes(1);

    release();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
  });

  it('reset drops a pending rerun', async () => {
    const gate = new HealthCheckGate();
    let release!: () => void;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(async () => undefined);

    gate.request(run);
    gate.request(run);
    gate.reset();
    release();
    await Promise.resolve();
    await Promise.resolve();

    expect(run).toHaveBeenCalledTimes(1);
  });
});
