import { VlessConfig } from './types';

export type SafeVlessConfig = Omit<VlessConfig, 'rawConfig'>;

export function toSafeServer(server: VlessConfig): SafeVlessConfig {
  const { rawConfig: _rawConfig, ...rest } = server;
  return rest;
}

export function toSafeServerList(servers: VlessConfig[]): SafeVlessConfig[] {
  return servers.map(toSafeServer);
}
