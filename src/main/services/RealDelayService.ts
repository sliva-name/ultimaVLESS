import { spawn } from 'child_process';
import http from 'http';
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
import type { PingServersOptions } from './PingService';

/** Same probe v2rayN uses for its "real delay": tiny, cacheless, plain HTTP. */
export const REAL_DELAY_TEST_URL = 'http://www.gstatic.com/generate_204';
/**
 * Floor for the HTTP budget. The figure includes the proxy handshake
 * (TLS/REALITY) and a round trip to the probe host, so the TCP-ping timeouts
 * the ping runner passes in would fail healthy but distant servers.
 */
export const REAL_DELAY_MIN_TIMEOUT_MS = 5000;
const DELAY_TEST_INBOUND_TAG = 'delay-test-in';
const READINESS_TIMEOUT_MS = 3000;
const READINESS_RETRY_MS = 50;
const READINESS_PROBE_TIMEOUT_MS = 200;
const EXIT_GRACE_MS = 1000;
/** Each probe is a whole Xray process (~20-30 MB), so keep the pool small. */
const MAX_CONCURRENT_TESTS = 6;

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
    proxyPort: number,
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
 * inbound whose traffic is pinned to the server's `proxy` outbound. Split
 * tunnelling, the stats API and file logging are stripped so a user bypass
 * rule cannot send the probe direct and parallel instances never share a
 * port or a log file.
 */
export function buildDelayTestConfig(
  server: VlessConfig,
  port: number,
  performanceSettings: PerformanceSettings = DEFAULT_PERFORMANCE_SETTINGS,
): XrayConfig {
  const cfg = XrayConfigCompiler.compile(server, {
    logPath: '',
    connectionMode: 'proxy',
    performanceSettings: {
      ...performanceSettings,
      bypassDomains: [],
      bypassIps: [],
    },
  });

  cfg.log = { loglevel: 'warning', access: 'none' };
  delete cfg.api;
  delete cfg.stats;
  cfg.inbounds = [
    {
      tag: DELAY_TEST_INBOUND_TAG,
      listen: '127.0.0.1',
      port,
      protocol: 'http',
      settings: {},
    },
  ];
  const rules = (cfg.routing?.rules ?? []).filter(
    (rule) => !rule.inboundTag?.includes('api'),
  );
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
  if (Array.isArray(cfg.outbounds)) {
    cfg.outbounds = cfg.outbounds.filter((outbound) => outbound?.tag !== 'api');
  }
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

/**
 * Times one GET through a local HTTP proxy, from request start to response
 * headers. Anything but a 2xx/3xx (Xray answers a dead outbound by closing
 * the socket or with an error status) counts as a failure.
 */
export function measureHttpThroughProxy(
  proxyPort: number,
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<number | null> {
  if (signal?.aborted) return Promise.resolve(null);
  const target = new URL(url);
  return new Promise((resolve) => {
    let settled = false;
    const startedAt = performance.now();
    const req = http.request({
      host: '127.0.0.1',
      port: proxyPort,
      path: target.href,
      method: 'GET',
      agent: false,
      headers: {
        Host: target.host,
        'User-Agent': 'Mozilla/5.0',
        Connection: 'close',
      },
    });

    const finish = (latency: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      req.destroy();
      resolve(latency);
    };
    const onAbort = (): void => finish(null);
    const timer = setTimeout(() => finish(null), timeoutMs);

    signal?.addEventListener('abort', onAbort, { once: true });
    req.once('response', (res) => {
      const latency = Math.max(1, Math.round(performance.now() - startedAt));
      const status = res.statusCode ?? 0;
      res.resume();
      finish(status >= 200 && status < 400 ? latency : null);
    });
    req.once('error', () => finish(null));
    req.end();
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
 * the exact outbound a connection would use, and the figure is the time an
 * HTTP request through it takes. Unlike a TCP ping this fails servers that
 * accept connections but reject the handshake or cannot reach the internet.
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
    this.measure = options.measure ?? measureHttpThroughProxy;
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
    const results = new Map<string, number | null>();
    const timer = new PerfTimer('RealDelayService', 'pingServers');
    const { signal } = options;
    let cursor = 0;

    const runWorker = async (): Promise<void> => {
      while (cursor < servers.length && !signal?.aborted) {
        const server = servers[cursor];
        cursor += 1;
        if (!server) break;
        const latency = await this.testServer(server, timeout, signal);
        if (signal?.aborted) break;
        results.set(server.uuid, latency);
        options.onResult?.(server.uuid, latency);
      }
    };

    const workers = Math.min(this.maxConcurrent, servers.length);
    await Promise.all(Array.from({ length: workers }, () => runWorker()));

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

    let port: number;
    let config: XrayConfig;
    try {
      port = await this.allocatePort();
      config = buildDelayTestConfig(
        server,
        port,
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
      const ready = await this.waitForListener(port, instance.exited, signal);
      if (!ready || signal?.aborted) {
        logger.debug('RealDelayService', 'Delay test Xray never listened', {
          server: server.name,
        });
        return null;
      }
      const latency = await this.measure(
        port,
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
