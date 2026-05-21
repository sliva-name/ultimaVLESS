import { VlessConfig } from './types';
import type { ConnectionMonitorEvent } from './ipc';

export type SafeVlessConfig = Omit<VlessConfig, 'rawConfig'>;

export function toSafeServer(server: VlessConfig): SafeVlessConfig {
  const { rawConfig: _rawConfig, ...rest } = server;
  return rest;
}

export function toSafeServerList(servers: VlessConfig[]): SafeVlessConfig[] {
  return servers.map(toSafeServer);
}

export function toSafeConnectionMonitorEvent(event: {
  type: ConnectionMonitorEvent['type'];
  server: VlessConfig | null;
  error?: string;
  message?: string;
}): ConnectionMonitorEvent {
  return {
    ...event,
    server: event.server ? toSafeServer(event.server) : null,
  };
}

export function getServerProtocolLabel(
  server: Pick<VlessConfig, 'protocol' | 'security'>,
): string {
  const protocol = server.protocol ?? 'vless';
  if (protocol === 'trojan') return 'TROJAN';
  if (protocol === 'shadowsocks') return 'SHADOWSOCKS';
  if (server.security === 'reality') return 'REALITY';
  return 'VLESS';
}

function resolvePingValue(server: VlessConfig): number | null {
  if (typeof server.ping === 'number' && Number.isFinite(server.ping)) {
    return server.ping;
  }
  return null;
}

/** Servers with a measured ping first (lowest latency on top). */
export function sortByPingAvailability(servers: VlessConfig[]): VlessConfig[] {
  return [...servers].sort((left, right) => {
    const leftPing = resolvePingValue(left);
    const rightPing = resolvePingValue(right);

    if (leftPing === null && rightPing === null) return 0;
    if (leftPing === null) return 1;
    if (rightPing === null) return -1;
    return leftPing - rightPing;
  });
}
