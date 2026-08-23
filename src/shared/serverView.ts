import { VlessConfig } from './types';
import { uniqueCatalogServers } from './serverIdentity';

/**
 * Renderer-facing server row. Secrets stay in main; the UI only needs
 * identity, display and latency.
 */
export type SafeServerConfig = {
  uuid: string;
  name: string;
  address: string;
  port: number;
  protocol?: VlessConfig['protocol'];
  source?: VlessConfig['source'];
  subscriptionId?: string;
  type?: VlessConfig['type'];
  security?: VlessConfig['security'];
  sni?: string;
  fp?: string;
  flow?: string;
  ping?: number | null;
  pingTime?: number;
  pingStale?: boolean;
};

export function toSafeServer(server: VlessConfig): SafeServerConfig {
  const safe: SafeServerConfig = {
    uuid: server.uuid,
    name: server.name,
    address: server.address,
    port: server.port,
  };
  if (server.protocol !== undefined) safe.protocol = server.protocol;
  if (server.source !== undefined) safe.source = server.source;
  if (server.subscriptionId !== undefined) {
    safe.subscriptionId = server.subscriptionId;
  }
  if (server.type !== undefined) safe.type = server.type;
  if (server.security !== undefined) safe.security = server.security;
  if (server.sni !== undefined) safe.sni = server.sni;
  if (server.fp !== undefined) safe.fp = server.fp;
  if (server.flow !== undefined) safe.flow = server.flow;
  if (server.ping !== undefined) safe.ping = server.ping;
  if (server.pingTime !== undefined) safe.pingTime = server.pingTime;
  if (server.pingStale !== undefined) safe.pingStale = server.pingStale;
  return safe;
}

let cachedFingerprint: string | null = null;
let cachedSafeList: SafeServerConfig[] | null = null;

function publicListFingerprint(servers: VlessConfig[]): string {
  return servers
    .map(
      (server) =>
        `${server.uuid}|${server.name}|${server.address}:${server.port}|${server.sni ?? ''}|${server.protocol ?? ''}|${server.ping ?? ''}|${server.pingTime ?? ''}|${server.pingStale ? 1 : 0}`,
    )
    .join('||');
}

/**
 * Projects the stored server list into the public DTO. Cache key is the
 * public-field fingerprint, not the array reference — in-place mutation
 * of secrets must not leak a stale unsafe object.
 */
export function toSafeServerList(servers: VlessConfig[]): SafeServerConfig[] {
  const unique = uniqueCatalogServers(servers);
  const fingerprint = publicListFingerprint(unique);
  if (cachedFingerprint === fingerprint && cachedSafeList) {
    return cachedSafeList;
  }
  const safe = unique.map(toSafeServer);
  cachedFingerprint = fingerprint;
  cachedSafeList = safe;
  return safe;
}
