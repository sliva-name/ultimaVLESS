import type { VlessConfig } from './types';
import { getServerConfigFingerprint } from './serverIdentity';

export type StoredPing = {
  ping: number | null;
  pingTime: number | undefined;
  pingStale: boolean | undefined;
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
      pingStale: server.pingStale,
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
): { stored: StoredPing; matchedByUuid: boolean } | undefined {
  const byUuid = overlay.byUuid.get(server.uuid);
  if (byUuid) {
    return { stored: byUuid, matchedByUuid: true };
  }
  const byFingerprint = overlay.byFingerprint.get(
    getServerConfigFingerprint(server),
  );
  return byFingerprint
    ? { stored: byFingerprint, matchedByUuid: false }
    : undefined;
}

/**
 * Re-applies stored latency onto a refreshed catalog.
 * Identity is uuid, then the full persisted-parameter fingerprint.
 *
 * A uuid is a hash of the endpoint and transport parameters, so a uuid match
 * means the very same server was measured: the figure keeps whatever
 * freshness it had. A fingerprint-only match survived a uuid rotation and is
 * flagged as last-known until a pass confirms it.
 */
export function applyPingOverlay(
  servers: VlessConfig[],
  overlay: ReturnType<typeof collectPingOverlay>,
): VlessConfig[] {
  return servers.map((server) => {
    const match = lookupStoredPing(overlay, server);
    if (!match) {
      return { ...server, ping: null, pingStale: false };
    }
    const { stored, matchedByUuid } = match;
    const hasLatency = stored.ping != null;
    return {
      ...server,
      ping: stored.ping,
      pingTime: stored.pingTime,
      pingStale: hasLatency && (!matchedByUuid || stored.pingStale === true),
    };
  });
}
