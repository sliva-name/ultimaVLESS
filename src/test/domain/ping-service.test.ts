import * as net from 'net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PingService } from '@/main/services/PingService';
import { makeServer } from '@/test/factories';

let server: net.Server;
let port: number;

beforeAll(async () => {
  server = net.createServer((socket) => socket.end());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as net.AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('PingService', () => {
  it('measures TCP connect latency and resolves each hostname once per pass', async () => {
    const lookup = vi.fn(async () => [{ address: '127.0.0.1', family: 4 }]);
    const service = new PingService({ lookup });
    const rows = [
      makeServer({ uuid: 'a', address: 'shared.example', port }),
      makeServer({ uuid: 'b', address: 'shared.example', port }),
      makeServer({ uuid: 'c', address: '127.0.0.1', port }),
    ];

    const results = await service.pingServers(rows, 1000);

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith('shared.example');
    for (const row of rows) {
      expect(results.get(row.uuid)).toEqual(expect.any(Number));
    }
  });

  it('prefers an IPv4 record when the resolver returns both families', async () => {
    const lookup = vi.fn(async () => [
      { address: '::1', family: 6 },
      { address: '127.0.0.1', family: 4 },
    ]);
    const service = new PingService({ lookup });

    const latency = await service.pingServer(
      makeServer({ uuid: 'a', address: 'dual.example', port }),
      1000,
    );

    expect(latency).toEqual(expect.any(Number));
  });

  it('reports null when the resolver fails or hangs, without touching the socket', async () => {
    const failing = new PingService({
      lookup: vi.fn(async () => {
        throw new Error('ENOTFOUND');
      }),
    });
    expect(
      await failing.pingServer(
        makeServer({ uuid: 'a', address: 'missing.example', port }),
        1000,
      ),
    ).toBeNull();

    const hanging = new PingService({
      lookup: vi.fn(() => new Promise(() => undefined)),
      dnsTimeoutMs: 20,
    });
    const started = Date.now();
    expect(
      await hanging.pingServer(
        makeServer({ uuid: 'a', address: 'slow.example', port }),
        1000,
      ),
    ).toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('reports null for a closed port', async () => {
    const closed = net.createServer();
    await new Promise<void>((resolve) =>
      closed.listen(0, '127.0.0.1', resolve),
    );
    const closedPort = (closed.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    const service = new PingService();
    expect(
      await service.pingServer(
        makeServer({ uuid: 'a', address: '127.0.0.1', port: closedPort }),
        1000,
      ),
    ).toBeNull();
  });

  it('stops dequeuing targets once the pass is aborted', async () => {
    const service = new PingService({ maxConcurrentPings: 1 });
    const controller = new AbortController();
    const rows = Array.from({ length: 5 }, (_, index) =>
      makeServer({ uuid: `s-${index}`, address: '127.0.0.1', port }),
    );
    const seen: string[] = [];

    const results = await service.pingServers(rows, 1000, {
      signal: controller.signal,
      onResult: (uuid) => {
        seen.push(uuid);
        controller.abort();
      },
    });

    expect(seen).toEqual(['s-0']);
    expect(results.size).toBe(1);
  });
});
