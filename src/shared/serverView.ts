import { VlessConfig } from './types';

export type SafeVlessConfig = Omit<VlessConfig, 'rawConfig'>;

export function toSafeServer(server: VlessConfig): SafeVlessConfig {
  const { rawConfig: _rawConfig, ...rest } = server;
  return rest;
}

let cachedSource: VlessConfig[] | null = null;
let cachedSafeList: SafeVlessConfig[] | null = null;

/**
 * Strips `rawConfig` before IPC. Reuses the last projection when the same
 * servers array reference is sent again (common on no-op refreshes).
 */
export function toSafeServerList(servers: VlessConfig[]): SafeVlessConfig[] {
  if (cachedSource === servers && cachedSafeList) {
    return cachedSafeList;
  }
  const safe = servers.map(toSafeServer);
  cachedSource = servers;
  cachedSafeList = safe;
  return safe;
}
