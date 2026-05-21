import { VlessConfig } from './types';

export const DEFAULT_MIN_PING_INTERVAL_MS = 30_000;

/**
 * Servers that need a latency measurement on a non-forced refresh.
 */
export function filterServersNeedingPing(
  servers: VlessConfig[],
  options: {
    force?: boolean;
    minPingIntervalMs?: number;
    now?: number;
  } = {},
): VlessConfig[] {
  const {
    force = false,
    minPingIntervalMs = DEFAULT_MIN_PING_INTERVAL_MS,
    now = Date.now(),
  } = options;

  if (force) {
    return servers;
  }

  return servers.filter((server) => {
    if (!server.pingTime || server.pingTime <= 0) {
      return true;
    }
    if (server.pingStale) {
      return true;
    }
    return now - server.pingTime >= minPingIntervalMs;
  });
}

export function allServersHaveFreshPing(
  servers: VlessConfig[],
  minPingIntervalMs: number = DEFAULT_MIN_PING_INTERVAL_MS,
  now: number = Date.now(),
): boolean {
  if (servers.length === 0) {
    return true;
  }
  return servers.every((server) => {
    if (!server.pingTime || server.pingTime <= 0) {
      return false;
    }
    if (server.pingStale) {
      return false;
    }
    return now - server.pingTime < minPingIntervalMs;
  });
}
