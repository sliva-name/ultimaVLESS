import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import net from 'net';
import path from 'path';
import {
  DEFAULT_PERFORMANCE_SETTINGS,
  PerformanceSettings,
  VlessConfig,
} from '@/shared/types';
import type { XrayConfig } from '@/shared/xray-types';
import { PerfTimer } from '@/shared/perfMetrics';
import { getBinResourcesPath } from '@/main/utils/runtimePaths';
import { XrayConfigCompiler } from './XrayConfigCompiler';
import { logger } from './LoggerService';
import { probeTcpPort } from './networkProbe';
import { trackOwnedXrayProcess } from './xray/ownedProcesses';
import { probeServers, type PingServersOptions } from './serverLatencyProbe';

/** Same probe v2rayN uses for its "real delay": tiny, cacheless, plain HTTP. */
export const REAL_DELAY_TEST_URL = 'http://www.gstatic.com/generate_204';
/**
 * Floor for the HTTP budget. It covers the proxy handshake (TLS/REALITY,
 * QUIC) and two round trips to the probe host, so the TCP-ping timeouts the
 * ping runner passes in would fail healthy but distant servers.
 */
export const REAL_DELAY_MIN_TIMEOUT_MS = 5000;
const DELAY_TEST_INBOUND_TAG = 'delay-test-in';
const READINESS_TIMEOUT_MS = 3000;
const READINESS_RETRY_MS = 50;
const READINESS_PROBE_TIMEOUT_MS = 200;
const EXIT_GRACE_MS = 1000;
/** Each probe is a whole Xray process (~20-30 MB), so keep the pool small. */
const MAX_CONCURRENT_TESTS = 6;

/**
 * The probe's loopback HTTP proxy: a fresh port and a one-off login. Every
 * local program can reach loopback, so without the login any of them could
 * send traffic through the server under test and learn its address.
 */
export interface DelayTestProxy {
  port: number;
  user: string;
  pass: string;
}

/** A throwaway Xray started for one measurement. */
export interface DelayTestProcess {
  /** Settles once the process is gone (exit or spawn error). */
  readonly exited: Promise<void>;
  kill(): void;
}

export interface RealDelayServiceOptions {
  spawnXray?: (config: XrayConfig) => DelayTestProcess;
  allocatePort?: () => Promise<number>;
  waitForListener?: (
    port: number,
    exited: Promise<void>,
    signal?: AbortSignal,
  ) => Promise<boolean>;
  measure?: (
    proxy: DelayTestProxy,
    url: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ) => Promise<number | null>;
  getPerformanceSettings?: () => PerformanceSettings;
  maxConcurrent?: number;
  testUrl?: string;
}

/**
 * Turns a connection config into a probe-only one: a single loopback HTTP
 * inbound, behind the probe's login, whose traffic is pinned to the server's
 * `proxy` outbound. Split tunnelling, the stats API and file logging are
 * stripped so a user bypass rule cannot send the probe direct and parallel
 * instances never share a port or a log file.
 */
export function buildDelayTestConfig(
  server: VlessConfig,
  proxy: DelayTestProxy,
  performanceSettings: PerformanceSettings = DEFAULT_PERFORMANCE_SETTINGS,
): XrayConfig {
  const cfg = XrayConfigCompiler.compile(server, {
    logPath: '',
    connectionMode: 'proxy',
    performanceSettings: {
      ...performanceSettings,
      bypassDomains: [],
      bypassIps: [],
      // Process rules would only cost a socket-table lookup per probe.
      routingMode: 'all',
      proxyDomains: [],
      proxyIps: [],
      proxyApps: [],
      directApps: [],
    },
  });

  cfg.log = { loglevel: 'warning', access: 'none' };
  delete cfg.api;
  delete cfg.stats;
  cfg.inbounds = [
    {
      tag: DELAY_TEST_INBOUND_TAG,
      listen: '127.0.0.1',
      port: proxy.port,
      protocol: 'http',
      settings: { accounts: [{ user: proxy.user, pass: proxy.pass }] },
    },
  ];
  const rules = cfg.routing?.rules ?? [];
  cfg.routing = {
    domainStrategy: cfg.routing?.domainStrategy ?? 'AsIs',
    ...cfg.routing,
    rules: [
      {
        type: 'field',
        inboundTag: [DELAY_TEST_INBOUND_TAG],
        outboundTag: 'proxy',
      },
      ...rules,
    ],
  };
  return cfg;
}

/** Reserves an ephemeral loopback port by binding and releasing it. */
export function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() =>
        port > 0 ? resolve(port) : reject(new Error('No port assigned')),
      );
    });
  });
}

/** A probe target's 204 has a few hundred bytes of headers. */
const MAX_RESPONSE_HEAD_BYTES = 16 * 1024;

interface ResponseHead {
  status: number;
  /** Body bytes to skip before the next response on the same connection. */
  bodyLength: number;
  /** Whether a second request can follow on this connection. */
  reusable: boolean;
}

function parseResponseHead(head: string): ResponseHead {
  const [statusLine = '', ...lines] = head.split('\r\n');
  const status = Number(statusLine.split(' ')[1]) || 0;
  let contentLength: number | null = null;
  let reusable = /^HTTP\/1\.1 /i.test(statusLine);
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line
      .slice(colon + 1)
      .trim()
      .toLowerCase();
    if (name === 'content-length') contentLength = Number(value);
    if (name === 'connection' && value.includes('close')) reusable = false;
    if (name === 'transfer-encoding' && value !== 'identity') reusable = false;
  }
  const bodyless = status === 204 || status === 304 || status < 200;
  if (
    !bodyless &&
    (contentLength === null || !Number.isFinite(contentLength))
  ) {
    // The body runs until the server closes the connection.
    reusable = false;
  }
  return {
    status,
    bodyLength: bodyless ? 0 : Math.max(0, contentLength ?? 0),
    reusable,
  };
}

const isSuccess = (status: number): boolean => status >= 200 && status < 400;

/**
 * Real delay on an open tunnel: one CONNECT through the probe's HTTP inbound,
 * then two GETs over it (plain-HTTP `url` only).
 *
 * The first request pays for the proxy's own setup (TCP + TLS/REALITY, or
 * QUIC + Hysteria auth) and is what proves the server passes traffic: if it
 * fails, the server is reported dead. The second is the round trip an app
 * sees once connected, comparable across protocols, and is the figure
 * reported. When the target will not keep the connection open, or the second
 * request fails or runs out of time, the first figure is reported instead.
 */
export function measureTunnelDelay(
  proxy: DelayTestProxy,
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<number | null> {
  if (signal?.aborted) return Promise.resolve(null);
  const target = new URL(url);
  if (target.protocol !== 'http:') {
    logger.debug('RealDelayService', 'Delay test URL must be plain HTTP', {
      url,
    });
    return Promise.resolve(null);
  }
  const authority = `${target.hostname}:${target.port || 80}`;
  const login = btoa(`${proxy.user}:${proxy.pass}`);
  const request =
    `GET ${target.pathname}${target.search} HTTP/1.1\r\n` +
    `Host: ${target.host}\r\nUser-Agent: Mozilla/5.0\r\nAccept: */*\r\n\r\n`;

  return new Promise((resolve) => {
    let settled = false;
    let stage: 'tunnel' | 'first' | 'body' | 'second' = 'tunnel';
    let pending = Buffer.alloc(0);
    let skip = 0;
    let sentAt = 0;
    let first: number | null = null;

    const socket = net.connect({ host: '127.0.0.1', port: proxy.port });
    socket.setNoDelay(true);

    const finish = (latency: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      socket.destroy();
      resolve(latency);
    };
    const onAbort = (): void => finish(null);
    // Running out of time on the second request still leaves a working server.
    const timer = setTimeout(() => finish(first), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });

    const send = (): void => {
      sentAt = performance.now();
      socket.write(request);
    };
    const elapsed = (): number =>
      Math.max(1, Math.round(performance.now() - sentAt));

    const pump = (): void => {
      while (!settled) {
        if (stage === 'body') {
          const n = Math.min(skip, pending.length);
          pending = pending.subarray(n);
          skip -= n;
          if (skip > 0) return;
          stage = 'second';
          send();
          continue;
        }
        const end = pending.indexOf('\r\n\r\n');
        if (end < 0) {
          if (pending.length > MAX_RESPONSE_HEAD_BYTES) finish(first);
          return;
        }
        const head = parseResponseHead(
          pending.subarray(0, end).toString('latin1'),
        );
        pending = pending.subarray(end + 4);
        if (stage === 'tunnel') {
          // 407 for a wrong login; Xray answers CONNECT before dialing out.
          if (head.status !== 200) return finish(null);
          stage = 'first';
          send();
        } else if (stage === 'first') {
          // Xray answers a dead outbound by closing the tunnel or with an
          // error status.
          if (!isSuccess(head.status)) return finish(null);
          first = elapsed();
          if (!head.reusable) return finish(first);
          skip = head.bodyLength;
          stage = 'body';
        } else {
          return finish(isSuccess(head.status) ? elapsed() : first);
        }
      }
    };

    socket.once('connect', () => {
      socket.write(
        `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n` +
          `Proxy-Authorization: Basic ${login}\r\n\r\n`,
      );
    });
    socket.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      pump();
    });
    socket.once('error', () => finish(first));
    socket.once('close', () => finish(first));
  });
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function waitForLoopbackListener(
  port: number,
  exited: Promise<void>,
  signal?: AbortSignal,
): Promise<boolean> {
  let gone = false;
  void exited.then(() => {
    gone = true;
  });
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  while (Date.now() <= deadline && !gone && !signal?.aborted) {
    if (
      await probeTcpPort(port, '127.0.0.1', READINESS_PROBE_TIMEOUT_MS, signal)
    ) {
      return !gone;
    }
    await delay(READINESS_RETRY_MS);
  }
  return false;
}

function spawnBundledXray(config: XrayConfig): DelayTestProcess {
  const resourcesPath = getBinResourcesPath();
  const binPath = path.join(
    resourcesPath,
    process.platform === 'win32' ? 'xray.exe' : 'xray',
  );
  // `stdin:` keeps credentials off disk and needs no cleanup.
  const child = spawn(binPath, ['run', '-c', 'stdin:'], {
    env: { ...process.env, XRAY_LOCATION_ASSET: resourcesPath },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  trackOwnedXrayProcess(child);
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.once('error', (error) => {
      logger.debug('RealDelayService', 'Xray spawn failed', {
        error: error.message,
      });
      resolve();
    });
  });
  child.stdout?.resume();
  child.stderr?.on('data', (data: Buffer) => {
    logger.debug('RealDelayService', 'Xray output', {
      data: data.toString().trim(),
    });
  });
  child.stdin?.on('error', () => {
    // The process died before reading its config; `exited` reports it.
  });
  child.stdin?.end(JSON.stringify(config));
  return {
    exited,
    kill: () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
      }
    },
  };
}

/**
 * v2rayN-style "real delay": each server gets its own short-lived Xray with
 * the exact outbound a connection would use, and HTTP requests go through
 * it. Unlike a TCP ping this fails servers that accept connections but reject
 * the handshake or cannot reach the internet. The figure is the round trip on
 * the already open tunnel ({@link measureTunnelDelay}), so a protocol with a
 * longer handshake (Hysteria2's QUIC + auth) does not look three times slower
 * than the connection really is.
 */
export class RealDelayService {
  private readonly spawnXray: (config: XrayConfig) => DelayTestProcess;
  private readonly allocatePort: () => Promise<number>;
  private readonly waitForListener: NonNullable<
    RealDelayServiceOptions['waitForListener']
  >;
  private readonly measure: NonNullable<RealDelayServiceOptions['measure']>;
  private readonly getPerformanceSettings: () => PerformanceSettings;
  private readonly maxConcurrent: number;
  private readonly testUrl: string;

  constructor(options: RealDelayServiceOptions = {}) {
    this.spawnXray = options.spawnXray ?? spawnBundledXray;
    this.allocatePort = options.allocatePort ?? allocateLoopbackPort;
    this.waitForListener = options.waitForListener ?? waitForLoopbackListener;
    this.measure = options.measure ?? measureTunnelDelay;
    this.getPerformanceSettings =
      options.getPerformanceSettings ?? (() => DEFAULT_PERFORMANCE_SETTINGS);
    this.maxConcurrent = Math.max(
      1,
      options.maxConcurrent ?? MAX_CONCURRENT_TESTS,
    );
    this.testUrl = options.testUrl ?? REAL_DELAY_TEST_URL;
  }

  public pingServer(
    server: VlessConfig,
    timeout: number = REAL_DELAY_MIN_TIMEOUT_MS,
  ): Promise<number | null> {
    return this.testServer(server, timeout);
  }

  public async pingServers(
    servers: VlessConfig[],
    timeout: number = REAL_DELAY_MIN_TIMEOUT_MS,
    options: PingServersOptions = {},
  ): Promise<Map<string, number | null>> {
    const timer = new PerfTimer('RealDelayService', 'pingServers');
    const { signal } = options;
    const results = await probeServers(
      servers,
      this.maxConcurrent,
      options,
      (server) => this.testServer(server, timeout, signal),
    );

    timer.end({
      totalServers: servers.length,
      resultsCount: results.size,
      aborted: signal?.aborted ?? false,
    });
    return results;
  }

  private async testServer(
    server: VlessConfig,
    timeout: number,
    signal?: AbortSignal,
  ): Promise<number | null> {
    if (signal?.aborted) return null;

    let proxy: DelayTestProxy;
    let config: XrayConfig;
    try {
      proxy = {
        port: await this.allocatePort(),
        user: randomUUID(),
        pass: randomUUID(),
      };
      config = buildDelayTestConfig(
        server,
        proxy,
        this.getPerformanceSettings(),
      );
    } catch (error) {
      logger.debug('RealDelayService', 'Cannot build delay test config', {
        server: server.name,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
    if (signal?.aborted) return null;

    let instance: DelayTestProcess;
    try {
      instance = this.spawnXray(config);
    } catch (error) {
      logger.debug('RealDelayService', 'Xray spawn failed', {
        server: server.name,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

    try {
      const ready = await this.waitForListener(
        proxy.port,
        instance.exited,
        signal,
      );
      if (!ready || signal?.aborted) {
        logger.debug('RealDelayService', 'Delay test Xray never listened', {
          server: server.name,
        });
        return null;
      }
      const latency = await this.measure(
        proxy,
        this.testUrl,
        Math.max(timeout, REAL_DELAY_MIN_TIMEOUT_MS),
        signal,
      );
      logger.debug('RealDelayService', 'Real delay measured', {
        server: server.name,
        latency,
      });
      return signal?.aborted ? null : latency;
    } finally {
      instance.kill();
      // Reap before the worker starts the next process so a large catalog
      // never piles up dying Xray instances.
      await Promise.race([instance.exited, delay(EXIT_GRACE_MS)]);
    }
  }
}
