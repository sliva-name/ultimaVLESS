import { describe, expect, it } from 'vitest';
import { probeTcpPort } from '@/main/services/networkProbe';

describe('network probe abort', () => {
  it('probeTcpPort returns false when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      probeTcpPort(9, '127.0.0.1', 5_000, controller.signal),
    ).resolves.toBe(false);
  });

  it('probeTcpPort drops an in-flight connect when aborted', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = probeTcpPort(80, '192.0.2.1', 10_000, controller.signal);
    controller.abort();

    await expect(pending).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
