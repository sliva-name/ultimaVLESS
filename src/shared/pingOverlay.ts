import type { VlessConfig } from './types';
import { getServerConfigFingerprint } from './serverIdentity';

export type StoredPing = {
  ping: number | null;
  pingTime: number | undefined;
};

export function collectPingOverlay(servers: VlessConfig[]): {
  byUuid: Map<string, StoredPing>;
  byFingerprint: Map<string, StoredPing>;
} {
  const byUuid = new Map<string, StoredPing>();
  const byFingerprint = new Map<string, StoredPing>();

  for (const server of servers) {
    if (server.ping === undefined && server.pingTime === undefined) {
      continue;
    }
    const stored: StoredPing = {
      ping: server.ping ?? null,
      pingTime: server.pingTime,
    };
    byUuid.set(server.uuid, stored);
    const fingerprint = getServerConfigFingerprint(server);
    const previous = byFingerprint.get(fingerprint);
    if (!previous || (stored.pingTime ?? 0) > (previous.pingTime ?? 0)) {
      byFingerprint.set(fingerprint, stored);
    }
  }

  return { byUuid, byFingerprint };
}

export function lookupStoredPing(
  overlay: ReturnType<typeof collectPingOverlay>,
  server: VlessConfig,
): StoredPing | undefined {
  return (
    overlay.byUuid.get(server.uuid) ??
    overlay.byFingerprint.get(getServerConfigFingerprint(server))
  );
}

/**
 * Re-applies stored latency onto a refreshed catalog.
 * Identity is uuid, then connection fingerprint — not a shared CDN host:port.
 */
export function applyPingOverlay(
  servers: VlessConfig[],
  overlay: ReturnType<typeof collectPingOverlay>,
): VlessConfig[] {
  return servers.map((server) => {
    const stored = lookupStoredPing(overlay, server);
    if (!stored) {
      return { ...server, ping: null, pingStale: false };
    }
    return {
      ...server,
      ping: stored.ping,
      pingTime: stored.pingTime,
      pingStale: stored.ping != null,
    };
  });
}
