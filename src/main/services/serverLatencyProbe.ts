import type { PingMethod, VlessConfig } from '@/shared/types';
import type { PingServersOptions } from './PingService';

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
