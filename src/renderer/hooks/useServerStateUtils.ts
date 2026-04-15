import { VlessConfig } from '../../shared/types';
import { IElectronAPI } from '../preload.d';

export function findServerFuzzy(servers: VlessConfig[], target: VlessConfig): VlessConfig | null {
  return servers.find((server) => server.address === target.address && server.port === target.port && server.name === target.name) ?? null;
}

export function hasMissingPingData(servers: VlessConfig[]): boolean {
  return servers.some((server) => !server.pingTime || server.pingTime === 0);
}

export async function reconcileSelection(
  newServers: VlessConfig[],
  currentSelected: VlessConfig | null,
  electronAPI: IElectronAPI
): Promise<VlessConfig | null> {
  if (newServers.length === 0) return null;

  const savedId = await electronAPI.getSelectedServerId();
  const byId = savedId ? newServers.find((server) => server.uuid === savedId) : null;
  if (byId) return byId;

  if (currentSelected) {
    const fuzzy = findServerFuzzy(newServers, currentSelected);
    if (fuzzy) {
      void electronAPI.setSelectedServerId(fuzzy.uuid).catch(() => {});
      return fuzzy;
    }
  }

  return newServers[0];
}
