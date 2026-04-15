import type { VlessConfig } from '../../shared/types';

interface ActiveConnectionSnapshot {
  isConnected: boolean;
  currentServer: VlessConfig | null;
}

export function preserveActiveServerIfNeeded(
  refreshedServers: VlessConfig[],
  existingServers: VlessConfig[],
  monitorStatus: ActiveConnectionSnapshot,
  isXrayRunning: boolean,
  selectedServerId?: string | null
): VlessConfig[] {
  const toPreserve = new Map<string, VlessConfig>();

  const activeServer = monitorStatus.currentServer;
  if (isXrayRunning && monitorStatus.isConnected && activeServer) {
    if (!refreshedServers.some((server) => server.uuid === activeServer.uuid)) {
      const preservedServer = existingServers.find((server) => server.uuid === activeServer.uuid) ?? activeServer;
      toPreserve.set(preservedServer.uuid, preservedServer);
    }
  }

  if (selectedServerId && !refreshedServers.some((s) => s.uuid === selectedServerId)) {
    const selected = existingServers.find((s) => s.uuid === selectedServerId);
    if (selected) {
      toPreserve.set(selected.uuid, selected);
    }
  }

  if (toPreserve.size > 0) {
    return [...Array.from(toPreserve.values()), ...refreshedServers];
  }

  return refreshedServers;
}
