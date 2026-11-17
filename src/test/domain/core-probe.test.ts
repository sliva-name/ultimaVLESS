import http from 'http';
import type net from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  coreProbeRoute,
  probeTrafficThroughCore,
} from '@/main/services/coreProbe';

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

/** Stands in for Xray's HTTP inbound; records the marker of each request. */
async function startProxy(): Promise<{ port: number; markers: unknown[] }> {
  const markers: unknown[] = [];
  const server = http.createServer((req, res) => {
    markers.push(req.headers['x-ultima-probe']);
    res.writeHead(204).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as net.AddressInfo).port, markers };
}

describe('core probes', () => {
  it('mark each request the way the pin rule expects', async () => {
    const proxy = await startProxy();
    const ok = await probeTrafficThroughCore(
      { socks: 1, http: proxy.port },
      { timeoutMs: 2000, attempts: 1, gapMs: 0 },
    );

    expect(ok).toBe(true);
    const { rule, inbounds } = coreProbeRoute();
    expect(inbounds).toEqual([]);
    expect(rule.inboundTag).toEqual(['http']);
    const secret = rule.attrs?.['x-ultima-probe'];
    expect(secret).toMatch(/^[0-9a-f-]{36}$/);
    expect(proxy.markers.length).toBeGreaterThan(0);
    expect(proxy.markers.every((marker) => marker === secret)).toBe(true);
  });
});
