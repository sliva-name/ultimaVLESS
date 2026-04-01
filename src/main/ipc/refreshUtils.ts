import type { VlessConfig } from '../../shared/types';

interface ActiveConnectionSnapshot {
  isConnected: boolean;
  currentServer: VlessConfig | null;
}

export function preserveActiveServerIfNeeded(
  refreshedServers: VlessConfig[],
  existingServers: VlessConfig[],
  monitorStatus: ActiveConnectionSnapshot,
  isXrayRunning: boolean
): VlessConfig[] {
  const activeServer = monitorStatus.currentServer;
  if (!isXrayRunning || !monitorStatus.isConnected || !activeServer) {
    return refreshedServers;
  }

  const stillPresent = refreshedServers.some((server) => server.uuid === activeServer.uuid);
  if (stillPresent) {
    return refreshedServers;
  }

  const preservedServer = existingServers.find((server) => server.uuid === activeServer.uuid) ?? activeServer;
  return [preservedServer, ...refreshedServers];
}
