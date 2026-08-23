import * as net from 'net';
import { VlessConfig } from '@/shared/types';
import { logger } from './LoggerService';
import { probeTlsHandshake } from './networkProbe';
import { PerfTimer } from '@/shared/perfMetrics';

interface TlsCacheEntry {
  ok: boolean;
  expiresAt: number;
}

export interface PingServersOptions {
  onResult?: (uuid: string, latency: number | null) => void;
}

/**
 * Service for checking server latency (ping) via TCP connection attempts.
 */
export class PingService {
  private readonly DEFAULT_TIMEOUT = 1800;
  private readonly MAX_CONCURRENT_PINGS = 20;
  private static readonly TLS_OK_TTL_MS = 5 * 60 * 1000;
  private static readonly TLS_FAIL_TTL_MS = 60 * 1000;
  private readonly tlsCache = new Map<string, TlsCacheEntry>();

  public async pingServer(
    server: VlessConfig,
    timeout: number = this.DEFAULT_TIMEOUT,
  ): Promise<number | null> {
    const tcpLatency = await this.tcpPing(server, timeout);
    if (tcpLatency === null) {
      return null;
    }

    if (this.requiresTlsCheck(server)) {
      const sni = server.sni || server.address;
      const tlsOk = await this.validateTls(server, sni, timeout);
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

  private requiresTlsCheck(server: VlessConfig): boolean {
    return server.security === 'tls' || server.security === 'reality';
  }

  private tlsCacheKey(server: VlessConfig, sni: string): string {
    return `${server.address}:${server.port}:${sni}`;
  }

  private async validateTls(
    server: VlessConfig,
    sni: string,
    timeout: number,
  ): Promise<boolean> {
    const key = this.tlsCacheKey(server, sni);
    const cached = this.tlsCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.ok;
    }

    const tlsTimeout = Math.max(timeout, 4000);
    const tlsOk = await probeTlsHandshake(
      server.address,
      server.port,
      sni,
      tlsTimeout,
    );
    this.tlsCache.set(key, {
      ok: tlsOk,
      expiresAt:
        Date.now() +
        (tlsOk ? PingService.TLS_OK_TTL_MS : PingService.TLS_FAIL_TTL_MS),
    });
    return tlsOk;
  }

  private async tcpPing(
    server: VlessConfig,
    timeout: number,
  ): Promise<number | null> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const socket = new net.Socket();

      const cleanup = () => {
        socket.removeAllListeners();
        socket.destroy();
      };

      const onError = (error: Error) => {
        cleanup();
        logger.debug(
          'PingService',
          `TCP ping failed for ${server.name} (${server.address}:${server.port})`,
          { error: error.message },
        );
        resolve(null);
      };

      const onTimeout = () => {
        cleanup();
        logger.debug(
          'PingService',
          `TCP ping timeout for ${server.name} (${server.address}:${server.port})`,
        );
        resolve(null);
      };

      const onConnect = () => {
        const latency = Date.now() - startTime;
        cleanup();
        logger.debug(
          'PingService',
          `TCP ping success for ${server.name} (${server.address}:${server.port}): ${latency}ms`,
        );
        resolve(latency);
      };

      socket.setTimeout(timeout);
      socket.once('error', onError);
      socket.once('timeout', onTimeout);
      socket.once('connect', onConnect);

      try {
        socket.connect(server.port, server.address);
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
    const results = new Map<string, number | null>();
    const timer = new PerfTimer('PingService', 'pingServers');

    if (servers.length === 0) {
      timer.end({ count: 0 });
      return results;
    }

    const workersCount = Math.min(this.MAX_CONCURRENT_PINGS, servers.length);
    let cursor = 0;

    const runWorker = async () => {
      while (cursor < servers.length) {
        const index = cursor;
        cursor += 1;
        const server = servers[index];
        if (!server) break;

        const latency = await this.pingServer(server, timeout);
        results.set(server.uuid, latency);
        options.onResult?.(server.uuid, latency);
      }
    };

    await Promise.all(Array.from({ length: workersCount }, () => runWorker()));

    timer.end({
      totalServers: servers.length,
      resultsCount: results.size,
    });

    return results;
  }
}

export const pingService = new PingService();
