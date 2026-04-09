import * as net from 'net';
import { VlessConfig } from '../../shared/types';
import { logger } from './LoggerService';
import { probeTlsHandshake } from './networkProbe';

/**
 * Service for checking server latency (ping) via TCP connection attempts.
 * Measures the time it takes to establish a TCP connection to the server.
 */
export class PingService {
  private readonly DEFAULT_TIMEOUT = 1800; // Fast first result for UI
  private readonly MAX_CONCURRENT_PINGS = 20; // Higher concurrency for large server lists

  /**
   * Pings a single server.
   * For TLS/Reality servers, performs TCP connect followed by a TLS handshake
   * to detect servers that pass raw TCP but fail in practice (broken config, DPI block, etc.).
   * @param server - The server configuration to ping.
   * @param timeout - Connection timeout in milliseconds (default: 1800ms).
   * @returns Promise resolving to latency in milliseconds, or null if connection failed.
   */
  public async pingServer(server: VlessConfig, timeout: number = this.DEFAULT_TIMEOUT): Promise<number | null> {
    const tcpLatency = await this.tcpPing(server, timeout);
    if (tcpLatency === null) {
      return null;
    }

    if (this.requiresTlsCheck(server)) {
      const sni = server.sni || server.address;
      const tlsTimeout = Math.max(timeout, 4000);
      const tlsOk = await probeTlsHandshake(server.address, server.port, sni, tlsTimeout);
      if (!tlsOk) {
        logger.debug('PingService', `TLS handshake failed for ${server.name} (${server.address}:${server.port}, sni=${sni})`);
        return null;
      }
      logger.debug('PingService', `TLS handshake OK for ${server.name} (sni=${sni})`);
    }

    return tcpLatency;
  }

  /** Returns true if the server uses TLS or Reality and should be validated via TLS handshake. */
  private requiresTlsCheck(server: VlessConfig): boolean {
    return server.security === 'tls' || server.security === 'reality';
  }

  private async tcpPing(server: VlessConfig, timeout: number): Promise<number | null> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const socket = new net.Socket();

      const cleanup = () => {
        socket.removeAllListeners();
        socket.destroy();
      };

      const onError = (error: Error) => {
        cleanup();
        logger.debug('PingService', `TCP ping failed for ${server.name} (${server.address}:${server.port})`, { error: error.message });
        resolve(null);
      };

      const onTimeout = () => {
        cleanup();
        logger.debug('PingService', `TCP ping timeout for ${server.name} (${server.address}:${server.port})`);
        resolve(null);
      };

      const onConnect = () => {
        const latency = Date.now() - startTime;
        cleanup();
        logger.debug('PingService', `TCP ping success for ${server.name} (${server.address}:${server.port}): ${latency}ms`);
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

  /**
   * Generates a unique key for a server (address:port or uuid if unique).
   * @param server - The server configuration.
   * @returns Unique identifier string.
   */
  private getServerKey(server: VlessConfig): string {
    return server.uuid;
  }

  /**
   * Pings multiple servers with concurrency control.
   * @param servers - Array of server configurations to ping.
   * @param timeout - Connection timeout in milliseconds (default: 5000ms).
   * @returns Promise resolving to a map of server keys (address:port) to their latency values.
   */
  public async pingServers(
    servers: VlessConfig[],
    timeout: number = this.DEFAULT_TIMEOUT
  ): Promise<Map<string, number | null>> {
    const results = new Map<string, number | null>();
    
    if (servers.length === 0) {
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
        const key = this.getServerKey(server);
        logger.debug('PingService', `Ping result for ${server.name}`, {
          key,
          uuid: server.uuid.substring(0, 8) + '...',
          address: server.address,
          port: server.port,
          latency
        });
        results.set(key, latency);
      }
    };

    await Promise.all(Array.from({ length: workersCount }, () => runWorker()));
    
    logger.debug('PingService', 'All ping results', {
      totalServers: servers.length,
      resultsCount: results.size,
      uniqueUUIDs: new Set(servers.map(s => s.uuid)).size,
      uniqueKeys: results.size,
      results: Array.from(results.entries()).map(([key, latency]) => ({
        key,
        latency
      }))
    });

    return results;
  }

  /**
   * Pings a single server and returns the result with server info.
   * @param server - The server configuration to ping.
   * @param timeout - Connection timeout in milliseconds (default: 5000ms).
   * @returns Promise resolving to ping result object.
   */
  public async pingServerWithResult(
    server: VlessConfig,
    timeout: number = this.DEFAULT_TIMEOUT
  ): Promise<{ uuid: string; latency: number | null }> {
    const latency = await this.pingServer(server, timeout);
    return {
      uuid: server.uuid,
      latency
    };
  }
}

export const pingService = new PingService();

