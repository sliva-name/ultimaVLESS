import type { PingMethod, VlessConfig } from '@/shared/types';

export interface PingServersOptions {
  onResult?: (uuid: string, latency: number | null) => void;
  /** Stops dequeuing targets and tears down in-flight probes. */
  signal?: AbortSignal;
}

export interface ServerLatencyProbe {
  pingServer(server: VlessConfig, timeout?: number): Promise<number | null>;
  pingServers(
    servers: VlessConfig[],
    timeout: number,
    options?: PingServersOptions,
  ): Promise<Map<string, number | null>>;
}

/**
 * Sends each ping to the probe matching the user's current ping method, read
 * per call so a settings change applies to the very next pass.
 */
export function createServerLatencyProbe(deps: {
  tcp: ServerLatencyProbe;
  real: ServerLatencyProbe;
  getMethod: () => PingMethod;
}): ServerLatencyProbe {
  const pick = (): ServerLatencyProbe =>
    deps.getMethod() === 'real' ? deps.real : deps.tcp;
  return {
    pingServer: (server, timeout) => pick().pingServer(server, timeout),
    pingServers: (servers, timeout, options) =>
      pick().pingServers(servers, timeout, options),
  };
}

/**
 * Runs `probe` over `servers` with at most `concurrency` in flight and reports
 * each result as it lands. Stops taking rows once `signal` aborts; a probe torn
 * down by the abort is not a measurement and is not reported.
 */
export async function probeServers(
  servers: VlessConfig[],
  concurrency: number,
  options: PingServersOptions,
  probe: (server: VlessConfig) => Promise<number | null>,
): Promise<Map<string, number | null>> {
  const results = new Map<string, number | null>();
  const { signal, onResult } = options;
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < servers.length && !signal?.aborted) {
      const server = servers[cursor];
      cursor += 1;
      const latency = await probe(server);
      if (signal?.aborted) break;
      results.set(server.uuid, latency);
      onResult?.(server.uuid, latency);
    }
  };
  const workers = Math.min(Math.max(1, concurrency), servers.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}
