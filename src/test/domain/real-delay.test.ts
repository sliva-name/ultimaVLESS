import http from 'http';
import net from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDelayTestConfig,
  measureHttpThroughProxy,
  RealDelayService,
  REAL_DELAY_MIN_TIMEOUT_MS,
  type DelayTestProcess,
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

const servers: http.Server[] = [];

async function startProxy(
  handler: http.RequestListener,
): Promise<{ port: number; requests: string[] }> {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url ?? '');
    handler(req, res);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as net.AddressInfo).port, requests };
}

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
    const cfg = buildDelayTestConfig(vlessServer('a'), 23456, {
      ...DEFAULT_PERFORMANCE_SETTINGS,
      bypassDomains: ['www.gstatic.com'],
      bypassIps: ['0.0.0.0/0'],
    });

    expect(cfg.inbounds).toEqual([
      expect.objectContaining({
        listen: '127.0.0.1',
        port: 23456,
        protocol: 'http',
      }),
    ]);
    const [first, ...rest] = cfg.routing?.rules ?? [];
    expect(first).toMatchObject({
      inboundTag: [cfg.inbounds?.[0]?.tag],
      outboundTag: 'proxy',
    });
    // A user bypass rule must never send the probe around the server.
    expect(JSON.stringify(rest)).not.toContain('gstatic');
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

describe('measureHttpThroughProxy', () => {
  it('times a proxied GET and sends the absolute URL to the proxy', async () => {
    const proxy = await startProxy((_req, res) => {
      res.writeHead(204).end();
    });

    const latency = await measureHttpThroughProxy(
      proxy.port,
      'http://www.gstatic.com/generate_204',
      2000,
    );

    expect(latency).toEqual(expect.any(Number));
    expect(latency).toBeGreaterThan(0);
    expect(proxy.requests).toEqual(['http://www.gstatic.com/generate_204']);
  });

  it('fails on an error status, a closed socket, or a timeout', async () => {
    const failing = await startProxy((_req, res) => {
      res.writeHead(503).end();
    });
    const closing = await startProxy((req) => {
      req.socket.destroy();
    });
    const hanging = await startProxy(() => {
      // Never answers.
    });
    const url = 'http://www.gstatic.com/generate_204';

    await expect(
      measureHttpThroughProxy(failing.port, url, 2000),
    ).resolves.toBeNull();
    await expect(
      measureHttpThroughProxy(closing.port, url, 2000),
    ).resolves.toBeNull();
    await expect(
      measureHttpThroughProxy(hanging.port, url, 100),
    ).resolves.toBeNull();
  });

  it('gives up as soon as the signal aborts', async () => {
    const hanging = await startProxy(() => {});
    const controller = new AbortController();
    const pending = measureHttpThroughProxy(
      hanging.port,
      'http://www.gstatic.com/generate_204',
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
    const measure = vi.fn(async (port: number) =>
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
      30000,
      expect.stringContaining('generate_204'),
      REAL_DELAY_MIN_TIMEOUT_MS,
      undefined,
    );
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
      measure: async (_port, _url, _timeout, signal) =>
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
  it('defaults to TCP and keeps only known methods', () => {
    expect(normalizePerformanceSettings({}).pingMethod).toBe('tcp');
    expect(
      normalizePerformanceSettings({ pingMethod: 'bogus' }).pingMethod,
    ).toBe('tcp');
    expect(
      normalizePerformanceSettings({ pingMethod: 'real' }).pingMethod,
    ).toBe('real');
  });
});
