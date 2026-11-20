import net from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDelayTestConfig,
  measureTunnelDelay,
  RealDelayService,
  REAL_DELAY_MIN_TIMEOUT_MS,
  type DelayTestProcess,
  type DelayTestProxy,
} from '@/main/services/RealDelayService';
import { createServerLatencyProbe } from '@/main/services/serverLatencyProbe';
import { normalizePerformanceSettings } from '@/shared/performanceSettings';
import { DEFAULT_PERFORMANCE_SETTINGS } from '@/shared/types';
import { makeServer } from '@/test/factories';

const vlessServer = (uuid: string) =>
  makeServer({
    uuid,
    userId: '11111111-2222-3333-4444-555555555555',
    address: 'vpn.example.com',
    port: 443,
    protocol: 'vless',
    security: 'tls',
    sni: 'vpn.example.com',
  });

const servers: net.Server[] = [];
const sockets = new Set<net.Socket>();

interface TunnelProxy {
  port: number;
  /** CONNECT targets, one per tunnel. */
  connects: string[];
  logins: (string | undefined)[];
  /** Request lines received inside the tunnels. */
  requests: string[];
}

/**
 * Stands in for the probe Xray's HTTP inbound and the target behind it:
 * answers CONNECT, then hands each GET on the tunnel to `respond`.
 */
async function startTunnelProxy(
  respond: (index: number, socket: net.Socket) => void,
  connectStatus = 200,
): Promise<TunnelProxy> {
  const proxy: TunnelProxy = {
    port: 0,
    connects: [],
    logins: [],
    requests: [],
  };
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    let buffer = '';
    let tunnelOpen = false;
    let index = 0;
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      let end = buffer.indexOf('\r\n\r\n');
      while (end >= 0) {
        const head = buffer.slice(0, end);
        buffer = buffer.slice(end + 4);
        const [requestLine = '', ...headers] = head.split('\r\n');
        if (!tunnelOpen) {
          proxy.connects.push(requestLine.split(' ')[1] ?? '');
          proxy.logins.push(
            headers
              .find((h) => h.toLowerCase().startsWith('proxy-authorization:'))
              ?.slice('proxy-authorization:'.length)
              .trim(),
          );
          if (connectStatus !== 200) {
            socket.end(
              `HTTP/1.1 ${connectStatus} Nope\r\nContent-Length: 0\r\n\r\n`,
            );
            return;
          }
          tunnelOpen = true;
          socket.write('HTTP/1.1 200 Connection established\r\n\r\n');
        } else {
          proxy.requests.push(requestLine);
          respond(index++, socket);
        }
        end = buffer.indexOf('\r\n\r\n');
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  proxy.port = (server.address() as net.AddressInfo).port;
  return proxy;
}

const NO_CONTENT = 'HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n';
/** First answer slow (the proxy handshake), the next ones at once. */
const HANDSHAKE_MS = 150;
const slowFirst =
  (
    first: string,
    next: (socket: net.Socket) => void = (s) => s.write(NO_CONTENT),
  ) =>
  (index: number, socket: net.Socket) => {
    if (index === 0) setTimeout(() => socket.write(first), HANDSHAKE_MS);
    else next(socket);
  };

const LOGIN = { user: 'probe-user', pass: 'probe-pass' };
const at = (port: number): DelayTestProxy => ({ port, ...LOGIN });
const URL_204 = 'http://www.gstatic.com/generate_204';

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

function fakeProcess() {
  let exit!: () => void;
  const exited = new Promise<void>((resolve) => {
    exit = resolve;
  });
  const kill = vi.fn(() => exit());
  return { exited, kill } satisfies DelayTestProcess;
}

describe('buildDelayTestConfig', () => {
  it('exposes only a loopback HTTP inbound pinned to the proxy outbound', () => {
    const cfg = buildDelayTestConfig(vlessServer('a'), at(23456), {
      ...DEFAULT_PERFORMANCE_SETTINGS,
      bypassDomains: ['www.gstatic.com'],
      bypassIps: ['0.0.0.0/0'],
      routingMode: 'sites',
      proxyDomains: ['youtube.com'],
      directApps: ['UltimaVLESS.exe'],
    });

    expect(cfg.inbounds).toEqual([
      expect.objectContaining({
        listen: '127.0.0.1',
        port: 23456,
        protocol: 'http',
        // Other local programs would otherwise go through the server.
        settings: { accounts: [LOGIN] },
      }),
    ]);
    const [first, ...rest] = cfg.routing?.rules ?? [];
    expect(first).toMatchObject({
      inboundTag: [cfg.inbounds?.[0]?.tag],
      outboundTag: 'proxy',
    });
    // A user bypass rule must never send the probe around the server.
    expect(JSON.stringify(rest)).not.toContain('gstatic');
    expect(rest.some((rule) => rule.process !== undefined)).toBe(false);
    expect(rest[rest.length - 1]).toMatchObject({ outboundTag: 'proxy' });
    expect(cfg.outbounds?.find((o) => o.tag === 'proxy')).toMatchObject({
      protocol: 'vless',
    });
    expect(cfg.outbounds?.some((o) => o.tag === 'api')).toBe(false);
    expect(cfg.api).toBeUndefined();
    expect(cfg.stats).toBeUndefined();
    // No shared log file between parallel instances.
    expect(cfg.log).toEqual({ loglevel: 'warning', access: 'none' });
  });
});

describe('measureTunnelDelay', () => {
  it('reports the second GET on one tunnel, not the handshake-heavy first', async () => {
    const proxy = await startTunnelProxy(slowFirst(NO_CONTENT));

    const latency = await measureTunnelDelay(at(proxy.port), URL_204, 2000);

    expect(latency).toEqual(expect.any(Number));
    expect(latency).toBeGreaterThan(0);
    expect(latency).toBeLessThan(HANDSHAKE_MS - 50);
    // One tunnel, both requests inside it, behind the probe's login.
    expect(proxy.connects).toEqual(['www.gstatic.com:80']);
    expect(proxy.requests).toEqual([
      'GET /generate_204 HTTP/1.1',
      'GET /generate_204 HTTP/1.1',
    ]);
    expect(proxy.logins).toEqual([
      `Basic ${Buffer.from('probe-user:probe-pass').toString('base64')}`,
    ]);
  });

  it('skips a response body before the second request', async () => {
    const proxy = await startTunnelProxy(
      slowFirst('HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello'),
    );

    const latency = await measureTunnelDelay(at(proxy.port), URL_204, 2000);

    expect(latency).toBeLessThan(HANDSHAKE_MS - 50);
    expect(proxy.requests).toHaveLength(2);
  });

  it('falls back to the first figure when the tunnel cannot take a second request', async () => {
    const closes = await startTunnelProxy(
      slowFirst('HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n'),
    );
    const dropsSecond = await startTunnelProxy(
      slowFirst(NO_CONTENT, (socket) => socket.destroy()),
    );
    const failsSecond = await startTunnelProxy(
      slowFirst(NO_CONTENT, (socket) =>
        socket.write('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n'),
      ),
    );

    for (const proxy of [closes, dropsSecond, failsSecond]) {
      const latency = await measureTunnelDelay(at(proxy.port), URL_204, 2000);
      expect(latency).toBeGreaterThanOrEqual(HANDSHAKE_MS - 20);
    }
    // A closing target is never asked twice.
    expect(closes.requests).toHaveLength(1);
  });

  it('reports the first figure when the second request runs out of time', async () => {
    const proxy = await startTunnelProxy(
      slowFirst(NO_CONTENT, () => {
        // The second request never gets an answer.
      }),
    );

    const latency = await measureTunnelDelay(at(proxy.port), URL_204, 500);

    expect(latency).toBeGreaterThanOrEqual(HANDSHAKE_MS - 20);
  });

  it('fails when the tunnel or the first request fails', async () => {
    const wrongLogin = await startTunnelProxy(() => {}, 407);
    const failing = await startTunnelProxy((_i, socket) =>
      socket.write('HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\n\r\n'),
    );
    const closing = await startTunnelProxy((_i, socket) => socket.destroy());
    const hanging = await startTunnelProxy(() => {
      // Never answers.
    });

    await expect(
      measureTunnelDelay(at(wrongLogin.port), URL_204, 2000),
    ).resolves.toBeNull();
    await expect(
      measureTunnelDelay(at(failing.port), URL_204, 2000),
    ).resolves.toBeNull();
    await expect(
      measureTunnelDelay(at(closing.port), URL_204, 2000),
    ).resolves.toBeNull();
    await expect(
      measureTunnelDelay(at(hanging.port), URL_204, 100),
    ).resolves.toBeNull();
    // Only plain HTTP can be spoken on the tunnel.
    await expect(
      measureTunnelDelay(at(hanging.port), 'https://www.gstatic.com/', 100),
    ).resolves.toBeNull();
  });

  it('gives up as soon as the signal aborts', async () => {
    const hanging = await startTunnelProxy(() => {});
    const controller = new AbortController();
    const pending = measureTunnelDelay(
      at(hanging.port),
      URL_204,
      10_000,
      controller.signal,
    );
    controller.abort();
    await expect(pending).resolves.toBeNull();
  });
});

describe('RealDelayService', () => {
  it('starts one Xray per server, measures through its port, and always stops it', async () => {
    const processes: ReturnType<typeof fakeProcess>[] = [];
    const spawnXray = vi.fn(() => {
      const proc = fakeProcess();
      processes.push(proc);
      return proc;
    });
    let nextPort = 30000;
    const measure = vi.fn(async ({ port }: DelayTestProxy) =>
      port === 30001 ? null : port - 29000,
    );
    const onResult = vi.fn();
    const service = new RealDelayService({
      spawnXray,
      allocatePort: async () => nextPort++,
      waitForListener: async () => true,
      measure,
      maxConcurrent: 1,
    });

    const results = await service.pingServers(
      [vlessServer('a'), vlessServer('b'), vlessServer('c')],
      1800,
      { onResult },
    );

    expect(results).toEqual(
      new Map([
        ['a', 1000],
        ['b', null],
        ['c', 1002],
      ]),
    );
    expect(onResult).toHaveBeenCalledTimes(3);
    expect(spawnXray).toHaveBeenCalledTimes(3);
    expect(spawnXray.mock.calls[0]?.[0].inbounds?.[0]?.port).toBe(30000);
    for (const proc of processes) {
      expect(proc.kill).toHaveBeenCalledTimes(1);
    }
    // The TCP-ping timeout is too short for a proxied request.
    expect(measure).toHaveBeenCalledWith(
      expect.objectContaining({ port: 30000 }),
      expect.stringContaining('generate_204'),
      REAL_DELAY_MIN_TIMEOUT_MS,
      undefined,
    );
    // Each probe gets its own login, and measures with the one it runs.
    const logins = spawnXray.mock.calls.map(
      ([config]) => config.inbounds?.[0]?.settings,
    );
    expect(logins).toEqual(
      measure.mock.calls.map(([{ user, pass }]) => ({
        accounts: [{ user, pass }],
      })),
    );
    expect(new Set(measure.mock.calls.map(([{ pass }]) => pass)).size).toBe(3);
  });

  it('never runs more Xray instances than the concurrency limit', async () => {
    let running = 0;
    let peak = 0;
    const service = new RealDelayService({
      spawnXray: () => {
        running += 1;
        peak = Math.max(peak, running);
        const proc = fakeProcess();
        void proc.exited.then(() => {
          running -= 1;
        });
        return proc;
      },
      allocatePort: async () => 30000,
      waitForListener: async () => true,
      measure: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return 50;
      },
      maxConcurrent: 2,
    });

    const rows = Array.from({ length: 7 }, (_, i) => vlessServer(`s${i}`));
    const results = await service.pingServers(rows, 1800);

    expect(results.size).toBe(7);
    expect(peak).toBe(2);
    expect(running).toBe(0);
  });

  it('reports null without measuring when Xray never listens or cannot start', async () => {
    const measure = vi.fn(async () => 10);
    const neverReady = new RealDelayService({
      spawnXray: () => fakeProcess(),
      allocatePort: async () => 30000,
      waitForListener: async () => false,
      measure,
    });
    const spawnFails = new RealDelayService({
      spawnXray: () => {
        throw new Error('ENOENT');
      },
      allocatePort: async () => 30000,
      waitForListener: async () => true,
      measure,
    });

    await expect(neverReady.pingServer(vlessServer('a'))).resolves.toBeNull();
    await expect(spawnFails.pingServer(vlessServer('a'))).resolves.toBeNull();
    expect(measure).not.toHaveBeenCalled();
  });

  it('reports null for a server whose config cannot be compiled', async () => {
    const spawnXray = vi.fn(() => fakeProcess());
    const service = new RealDelayService({
      spawnXray,
      allocatePort: async () => 30000,
      waitForListener: async () => true,
      measure: async () => 10,
    });

    const latency = await service.pingServer(
      makeServer({ uuid: 'bad', protocol: 'vless', type: 'quic' }),
    );

    expect(latency).toBeNull();
    expect(spawnXray).not.toHaveBeenCalled();
  });

  it('stops dequeuing on abort and drops the in-flight measurement', async () => {
    const controller = new AbortController();
    const processes: ReturnType<typeof fakeProcess>[] = [];
    const onResult = vi.fn();
    const service = new RealDelayService({
      spawnXray: () => {
        const proc = fakeProcess();
        processes.push(proc);
        return proc;
      },
      allocatePort: async () => 30000,
      waitForListener: async () => true,
      measure: async (_proxy, _url, _timeout, signal) =>
        new Promise<number | null>((resolve) => {
          signal?.addEventListener('abort', () => resolve(null));
          controller.abort();
        }),
      maxConcurrent: 1,
    });

    const results = await service.pingServers(
      [vlessServer('a'), vlessServer('b')],
      1800,
      { onResult, signal: controller.signal },
    );

    expect(results.size).toBe(0);
    expect(onResult).not.toHaveBeenCalled();
    expect(processes).toHaveLength(1);
    expect(processes[0]?.kill).toHaveBeenCalled();
  });
});

describe('createServerLatencyProbe', () => {
  it('routes each call to the probe of the current ping method', async () => {
    const tcp = {
      pingServer: vi.fn(async () => 11),
      pingServers: vi.fn(async () => new Map([['a', 11]])),
    };
    const real = {
      pingServer: vi.fn(async () => 222),
      pingServers: vi.fn(async () => new Map([['a', 222]])),
    };
    let method: 'tcp' | 'real' = 'tcp';
    const probe = createServerLatencyProbe({
      tcp,
      real,
      getMethod: () => method,
    });

    await expect(probe.pingServer(vlessServer('a'))).resolves.toBe(11);
    method = 'real';
    await expect(probe.pingServer(vlessServer('a'))).resolves.toBe(222);
    await expect(probe.pingServers([vlessServer('a')], 1800)).resolves.toEqual(
      new Map([['a', 222]]),
    );
    expect(tcp.pingServers).not.toHaveBeenCalled();
  });
});

describe('pingMethod setting', () => {
  it('defaults to real delay and keeps only known methods', () => {
    expect(normalizePerformanceSettings({}).pingMethod).toBe('real');
    expect(
      normalizePerformanceSettings({ pingMethod: 'bogus' }).pingMethod,
    ).toBe('real');
    expect(normalizePerformanceSettings({ pingMethod: 'tcp' }).pingMethod).toBe(
      'tcp',
    );
  });
});
