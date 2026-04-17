import type { VlessConfig } from '@/shared/types';

interface ActiveConnectionSnapshot {
  isConnected: boolean;
  currentServer: VlessConfig | null;
}

/**
 * Returns true if `refreshedServers` already contains a config that refers to
 * the same physical server as `target`. Uuid alone isn't enough: our stable id
 * hashes the authToken (VLESS uuid / Trojan password) together with transport
 * params, so providers that rotate credentials or tweak `sni/pbk/sid/flow`
 * produce a different id for the same endpoint. We fall back to
 * protocol + address + port so the old entry isn't preserved as a ghost
 * duplicate next to the refreshed one.
 *
 * Note: this intentionally collapses multiple accounts that share the same
 * host:port onto each other. Subscriptions almost never list duplicate
 * endpoints, so we optimize for the common rotating-creds case. If a user
 * genuinely had two accounts on one host and the provider removes one,
 * the active config continues to live in `xray` memory; it will simply
 * not reappear in the sidebar on the next refresh.
 */
function isSameServerRepresented(refreshedServers: VlessConfig[], target: VlessConfig): boolean {
  if (refreshedServers.some((server) => server.uuid === target.uuid)) {
    return true;
  }

  const targetProtocol = target.protocol ?? 'vless';

  return refreshedServers.some((server) => {
    if (server.address !== target.address || server.port !== target.port) {
      return false;
    }
    return (server.protocol ?? 'vless') === targetProtocol;
  });
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
    if (!isSameServerRepresented(refreshedServers, activeServer)) {
      const preservedServer = existingServers.find((server) => server.uuid === activeServer.uuid) ?? activeServer;
      toPreserve.set(preservedServer.uuid, preservedServer);
    }
  }

  if (selectedServerId && !refreshedServers.some((s) => s.uuid === selectedServerId)) {
    const selected = existingServers.find((s) => s.uuid === selectedServerId);
    if (selected && !isSameServerRepresented(refreshedServers, selected)) {
      toPreserve.set(selected.uuid, selected);
    }
  }

  if (toPreserve.size > 0) {
    return [...Array.from(toPreserve.values()), ...refreshedServers];
  }

  return refreshedServers;
}
