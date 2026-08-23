import { createHash } from 'crypto';
import type { VlessConfig } from './types';

function normalizeIdentityPart(part: string | undefined | null): string {
  return part || '';
}

export function createHashedIdentityToken(
  prefix: string,
  secret: string,
  address: string,
  port: number,
): string {
  const digest = createHash('sha256')
    .update(`${secret}|${address}|${port}`)
    .digest('hex')
    .slice(0, 14);
  return `${prefix}${digest}`;
}

export function createStableServerId(
  authToken: string,
  address: string,
  port: number,
  parts: Array<string | undefined | null>,
): string {
  const signature = [
    authToken,
    address,
    String(port),
    ...parts.map(normalizeIdentityPart),
  ].join('|');
  const digest = createHash('sha256')
    .update(signature)
    .digest('hex')
    .slice(0, 16);
  return `${authToken.substring(0, 8)}-${address}:${port}-${digest}`;
}

const NON_IDENTITY_CATALOG_KEYS = new Set([
  'uuid',
  'ping',
  'pingTime',
  'pingStale',
  'source',
  'subscriptionId',
]);

function stableJson(value: unknown): string {
  if (value === undefined) {
    return '';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  return `{${entries
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
    .join(',')}}`;
}

/**
 * Every server parameter except catalog uuid, membership and live ping.
 * A single differing field (name, SNI, sid, path, userId, password, …)
 * is a different server.
 */
export function getServerConfigFingerprint(config: VlessConfig): string {
  const record = config as unknown as Record<string, unknown>;
  return Object.keys(record)
    .filter((key) => !NON_IDENTITY_CATALOG_KEYS.has(key))
    .sort()
    .map((key) => `${key}:${stableJson(record[key])}`)
    .join('|');
}

export function getServerCatalogKey(config: VlessConfig): string {
  return [
    config.uuid || '',
    config.source || '',
    config.subscriptionId || '',
    getServerConfigFingerprint(config),
  ].join('|');
}

export function getServerDedupKey(config: VlessConfig): string {
  return getServerCatalogKey(config);
}

export function getServerEndpointKey(config: VlessConfig): string {
  return `${config.protocol ?? 'vless'}|${config.address}:${config.port}`;
}

export function isSameServerIdentity(
  left: VlessConfig,
  right: VlessConfig,
): boolean {
  // Uuid can rotate; every other persisted parameter is identity.
  return getServerConfigFingerprint(left) === getServerConfigFingerprint(right);
}

function disambiguatedUuid(server: VlessConfig): string {
  const digest = createHash('sha256')
    .update(getServerConfigFingerprint(server))
    .digest('hex')
    .slice(0, 12);
  return `${server.uuid}~${digest}`;
}

/**
 * Keep every server that differs by any persisted field. Drop only exact
 * copies. If catalog uuids collided across distinct rows, suffix the later
 * ones so the sidebar can highlight a single card.
 */
export function uniqueCatalogServers(servers: VlessConfig[]): VlessConfig[] {
  const seenCatalogKeys = new Set<string>();
  const seenUuids = new Set<string>();
  const unique: VlessConfig[] = [];

  for (const server of servers) {
    const catalogKey = getServerCatalogKey(server);
    if (seenCatalogKeys.has(catalogKey)) {
      continue;
    }
    seenCatalogKeys.add(catalogKey);

    let next = server;
    if (seenUuids.has(server.uuid)) {
      let uuid = disambiguatedUuid(server);
      let suffix = 2;
      while (seenUuids.has(uuid)) {
        uuid = `${disambiguatedUuid(server)}-${suffix}`;
        suffix += 1;
      }
      next = { ...server, uuid };
    }
    seenUuids.add(next.uuid);
    unique.push(next);
  }
  return unique;
}

export function findMatchingServer(
  servers: VlessConfig[],
  target: VlessConfig,
): VlessConfig | undefined {
  return servers.find((server) => isSameServerIdentity(server, target));
}

export function isServerRepresented(
  servers: VlessConfig[],
  target: VlessConfig,
): boolean {
  return findMatchingServer(servers, target) !== undefined;
}
