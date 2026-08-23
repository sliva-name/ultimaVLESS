import type { VlessConfig } from '@/shared/types';
import { isServerRepresented } from '@/shared/serverIdentity';

/**
 * Keep the live/selected catalog rows when a refresh would drop them.
 * Live server is identified by the session owner, not by monitor/xray flags.
 */
export function preserveActiveServerIfNeeded(
  refreshedServers: VlessConfig[],
  existingServers: VlessConfig[],
  liveServerId: string | null,
  selectedServerId?: string | null,
): VlessConfig[] {
  const toPreserve = new Map<string, VlessConfig>();

  if (liveServerId && !isServerRepresentedById(refreshedServers, liveServerId)) {
    const preserved =
      existingServers.find((server) => server.uuid === liveServerId) ??
      refreshedServers.find((server) => server.uuid === liveServerId);
    if (preserved && !isServerRepresented(refreshedServers, preserved)) {
      toPreserve.set(preserved.uuid, preserved);
    }
  }

  if (
    selectedServerId &&
    !refreshedServers.some((server) => server.uuid === selectedServerId)
  ) {
    const selected = existingServers.find(
      (server) => server.uuid === selectedServerId,
    );
    if (selected && !isServerRepresented(refreshedServers, selected)) {
      toPreserve.set(selected.uuid, selected);
    }
  }

  if (toPreserve.size > 0) {
    return [...Array.from(toPreserve.values()), ...refreshedServers];
  }

  return refreshedServers;
}

function isServerRepresentedById(
  servers: VlessConfig[],
  serverId: string,
): boolean {
  return servers.some((server) => server.uuid === serverId);
}
