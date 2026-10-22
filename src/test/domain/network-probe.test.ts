import net from 'net';
import { describe, expect, it } from 'vitest';
import {
  probeInternetFromLocalAddresses,
  probeTcpPort,
} from '@/main/services/networkProbe';

describe('network probe local address', () => {
  it('probeTcpPort connects from the given local address', async () => {
    const remotes: string[] = [];
    const server = net.createServer((socket) => {
      remotes.push(socket.remoteAddress ?? '');
      socket.destroy();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as net.AddressInfo;
    try {
      await expect(
        probeTcpPort(port, '127.0.0.1', 2_000, undefined, '127.0.0.1'),
      ).resolves.toBe(true);
      // TEST-NET address is not assigned here, so the bind itself fails.
      await expect(
        probeTcpPort(port, '127.0.0.1', 2_000, undefined, '192.0.2.1'),
      ).resolves.toBe(false);
      await expect.poll(() => remotes).toEqual(['127.0.0.1']);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('probeInternetFromLocalAddresses is offline with no addresses to try', async () => {
    await expect(probeInternetFromLocalAddresses([])).resolves.toBe(false);
  });
});

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
