import * as dns from 'dns';
import * as net from 'net';
import { VlessConfig } from '@/shared/types';
import { logger } from './LoggerService';
import { probeTlsHandshake } from './networkProbe';
import { PerfTimer } from '@/shared/perfMetrics';
import { unbracketIpv6 } from '@/shared/networkAddresses';
import { probeServers, type PingServersOptions } from './serverLatencyProbe';

interface TlsCacheEntry {
  ok: boolean;
  expiresAt: number;
}

export type HostLookup = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

export interface PingServiceOptions {
  lookup?: HostLookup;
  dnsTimeoutMs?: number;
  maxConcurrentPings?: number;
}

/** One ping-all pass: hostnames are resolved once and shared by every row. */
interface ProbeContext {
  hosts: Map<string, Promise<string | null>>;
  signal?: AbortSignal;
}

const defaultLookup: HostLookup = (hostname) =>
  dns.promises.lookup(hostname, { all: true });

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => resolve(onTimeout()), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Server latency = TCP connect time to the resolved endpoint, confirmed by a
 * TLS handshake for tls/reality rows. DNS is resolved separately so that
 * (a) the figure does not include resolver time, (b) rows sharing a hostname
 * cost one lookup instead of one per row, and (c) a dead resolver cannot
 * saturate libuv's threadpool with one `getaddrinfo` per server.
 */
export class PingService {
  private readonly DEFAULT_TIMEOUT = 1800;
  private readonly maxConcurrentPings: number;
  private readonly dnsTimeoutMs: number;
  private readonly lookup: HostLookup;
  private static readonly TLS_OK_TTL_MS = 5 * 60 * 1000;
  private static readonly DNS_TIMEOUT_MS = 3000;
  private static readonly MAX_CONCURRENT_PINGS = 20;
  private readonly tlsCache = new Map<string, TlsCacheEntry>();

  constructor(options: PingServiceOptions = {}) {
    this.lookup = options.lookup ?? defaultLookup;
    this.dnsTimeoutMs = options.dnsTimeoutMs ?? PingService.DNS_TIMEOUT_MS;
    this.maxConcurrentPings =
      options.maxConcurrentPings ?? PingService.MAX_CONCURRENT_PINGS;
  }

  public async pingServer(
    server: VlessConfig,
    timeout: number = this.DEFAULT_TIMEOUT,
  ): Promise<number | null> {
    return this.probeServer(server, timeout, { hosts: new Map() });
  }

  private async probeServer(
    server: VlessConfig,
    timeout: number,
    context: ProbeContext,
  ): Promise<number | null> {
    if (context.signal?.aborted) {
      return null;
    }
    const host = await this.resolveHost(server.address, context);
    if (host === null || context.signal?.aborted) {
      if (host === null) {
        logger.debug(
          'PingService',
          `DNS lookup failed for ${server.name} (${server.address})`,
        );
      }
      return null;
    }

    const tcpLatency = await this.tcpPing(
      server,
      host,
      timeout,
      context.signal,
    );
    if (tcpLatency === null || context.signal?.aborted) {
      return null;
    }

    if (this.requiresTlsCheck(server)) {
      const sni = server.sni || server.address;
      const tlsOk = await this.validateTls(
        server,
        host,
        sni,
        timeout,
        context.signal,
      );
      if (context.signal?.aborted) {
        return null;
      }
      if (!tlsOk) {
        logger.debug(
          'PingService',
          `TLS handshake failed for ${server.name} (${server.address}:${server.port}, sni=${sni})`,
        );
        return null;
      }
      logger.debug(
        'PingService',
        `TLS handshake OK for ${server.name} (sni=${sni})`,
      );
    }

    return tcpLatency;
  }

  private resolveHost(
    rawAddress: string,
    context: ProbeContext,
  ): Promise<string | null> {
    // Servers saved by earlier builds may still hold `[ipv6]`.
    const address = unbracketIpv6(rawAddress);
    if (net.isIP(address) !== 0) {
      return Promise.resolve(address);
    }
    let pending = context.hosts.get(address);
    if (!pending) {
      pending = this.lookupAddress(address);
      context.hosts.set(address, pending);
    }
    return pending;
  }

  private async lookupAddress(hostname: string): Promise<string | null> {
    try {
      const records = await withTimeout(
        this.lookup(hostname),
        this.dnsTimeoutMs,
        () => [] as Array<{ address: string; family: number }>,
      );
      // Prefer IPv4: most hosts have no usable IPv6 route, and a v6-first
      // connect failure would report a live server as dead.
      const preferred =
        records.find((record) => record.family === 4) ?? records[0];
      return preferred?.address ?? null;
    } catch (error) {
      logger.debug('PingService', `DNS lookup error for ${hostname}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private requiresTlsCheck(server: VlessConfig): boolean {
    return server.security === 'tls' || server.security === 'reality';
  }

  private tlsCacheKey(server: VlessConfig, sni: string): string {
    return `${server.address}:${server.port}:${sni}`;
  }

  private async validateTls(
    server: VlessConfig,
    host: string,
    sni: string,
    timeout: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const key = this.tlsCacheKey(server, sni);
    const cached = this.tlsCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.ok;
    }

    const tlsTimeout = Math.max(timeout, 4000);
    const tlsOk = await probeTlsHandshake(
      host,
      server.port,
      sni,
      tlsTimeout,
      signal,
    );
    if (signal?.aborted) {
      // An aborted handshake says nothing about the server.
      return false;
    }
    // A timeout or handshake error is often transient (SNI blip, overloaded
    // edge). Caching it for a minute made the next auto-switch rank the
    // server dead and skip a live host.
    if (tlsOk) {
      this.tlsCache.set(key, {
        ok: true,
        expiresAt: Date.now() + PingService.TLS_OK_TTL_MS,
      });
    }
    return tlsOk;
  }

  private async tcpPing(
    server: VlessConfig,
    host: string,
    timeout: number,
    signal?: AbortSignal,
  ): Promise<number | null> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const socket = new net.Socket();
      let settled = false;

      const finish = (latency: number | null) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        socket.removeAllListeners();
        socket.destroy();
        resolve(latency);
      };

      const onAbort = () => finish(null);

      const onError = (error: Error) => {
        logger.debug(
          'PingService',
          `TCP ping failed for ${server.name} (${server.address}:${server.port})`,
          { error: error.message },
        );
        finish(null);
      };

      const onTimeout = () => {
        logger.debug(
          'PingService',
          `TCP ping timeout for ${server.name} (${server.address}:${server.port})`,
        );
        finish(null);
      };

      const onConnect = () => {
        const latency = Date.now() - startTime;
        logger.debug(
          'PingService',
          `TCP ping success for ${server.name} (${server.address}:${server.port}): ${latency}ms`,
        );
        finish(latency);
      };

      signal?.addEventListener('abort', onAbort, { once: true });
      socket.setTimeout(timeout);
      socket.once('error', onError);
      socket.once('timeout', onTimeout);
      socket.once('connect', onConnect);

      try {
        socket.connect(server.port, host);
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  public async pingServers(
    servers: VlessConfig[],
    timeout: number = this.DEFAULT_TIMEOUT,
    options: PingServersOptions = {},
  ): Promise<Map<string, number | null>> {
    const timer = new PerfTimer('PingService', 'pingServers');
    const context: ProbeContext = { hosts: new Map(), signal: options.signal };
    const results = await probeServers(
      servers,
      this.maxConcurrentPings,
      options,
      (server) => this.probeServer(server, timeout, context),
    );

    timer.end({
      totalServers: servers.length,
      resultsCount: results.size,
      aborted: options.signal?.aborted ?? false,
    });

    return results;
  }
}

export const pingService = new PingService();
