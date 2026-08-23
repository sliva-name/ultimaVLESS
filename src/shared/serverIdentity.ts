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

/**
 * Connection fingerprint without catalog uuid. Same tunnel after a provider
 * rotates the stored id; different tunnels that only share a CDN host:port
 * (different SNI/sid/path) stay distinct.
 */
export function getServerConfigFingerprint(config: VlessConfig): string {
  return [
    config.protocol || 'vless',
    config.address || '',
    String(config.port || 0),
    config.type || '',
    config.security || '',
    config.sni || '',
    config.fp || '',
    config.pbk || '',
    config.sid || '',
    config.spx || '',
    config.path || '',
    config.host || '',
    config.wsMaxEarlyData === undefined ? '' : String(config.wsMaxEarlyData),
    config.serviceName || '',
    config.flow || '',
    config.encryption || '',
    config.method || '',
    config.mode || '',
    JSON.stringify(config.xhttpExtra ?? {}),
    config.noGRPCHeader === undefined ? '' : String(config.noGRPCHeader),
    config.allowInsecure === undefined ? '' : String(config.allowInsecure),
    config.pinnedPeerCertSha256 || '',
    config.verifyPeerCertByName || '',
  ].join('|');
}

export function getServerDedupKey(config: VlessConfig): string {
  return `${config.uuid || ''}|${getServerConfigFingerprint(config)}`;
}

export function getServerEndpointKey(config: VlessConfig): string {
  return `${config.protocol ?? 'vless'}|${config.address}:${config.port}`;
}

export function isSameServerIdentity(
  left: VlessConfig,
  right: VlessConfig,
): boolean {
  // Uuid is not identity: subscription nodes on one CDN host can collide on
  // the stored id. Same tunnel after rotation shares the connection fingerprint.
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
 * One catalog row per tunnel. True duplicates (same fingerprint) are dropped.
 * Distinct tunnels that collided on uuid keep both rows: the later ones get a
 * fingerprint suffix so sidebar selection can highlight exactly one card.
 */
export function uniqueCatalogServers(servers: VlessConfig[]): VlessConfig[] {
  const seenFingerprints = new Set<string>();
  const seenUuids = new Set<string>();
  const unique: VlessConfig[] = [];

  for (const server of servers) {
    const fingerprint = getServerConfigFingerprint(server);
    if (seenFingerprints.has(fingerprint)) {
      continue;
    }
    seenFingerprints.add(fingerprint);

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
