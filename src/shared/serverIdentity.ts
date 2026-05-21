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

export function getServerDedupKey(config: VlessConfig): string {
  return [
    config.uuid || '',
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

export function getServerEndpointKey(config: VlessConfig): string {
  return `${config.protocol ?? 'vless'}|${config.address}:${config.port}`;
}

export function isSameServerIdentity(
  left: VlessConfig,
  right: VlessConfig,
): boolean {
  return (
    left.uuid === right.uuid ||
    getServerEndpointKey(left) === getServerEndpointKey(right)
  );
}

export function isServerRepresented(
  servers: VlessConfig[],
  target: VlessConfig,
): boolean {
  return servers.some((server) => isSameServerIdentity(server, target));
}
