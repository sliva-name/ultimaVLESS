import type { VlessConfig } from '@/shared/types';

export type AutoSwitchSelection =
  | { type: 'selected'; server: VlessConfig }
  | { type: 'selected-candidates'; candidates: VlessConfig[] }
  | { type: 'no-servers' }
  | { type: 'all-blocked' }
  | { type: 'same-server'; server: VlessConfig };

interface AutoSwitchCandidateOptions {
  maxCandidates?: number;
  now?: number;
  freshPingMaxAgeMs?: number;
}

interface RankedServer {
  server: VlessConfig;
  rank: number;
  latency: number;
  distance: number;
}

const DEFAULT_MAX_CANDIDATES = 30;
const DEFAULT_FRESH_PING_MAX_AGE_MS = 10 * 60 * 1000;

function getPingRank(
  server: VlessConfig,
  now: number,
  freshPingMaxAgeMs: number,
): number {
  if (typeof server.ping !== 'number' || server.ping < 0) {
    return server.ping === null ? 3 : 2;
  }
  const pingAge = server.pingTime
    ? now - server.pingTime
    : Number.POSITIVE_INFINITY;
  if (!server.pingStale && pingAge >= 0 && pingAge <= freshPingMaxAgeMs) {
    return 0;
  }
  return 1;
}

function getForwardDistance(
  serverIndex: number,
  currentIndex: number,
  totalServers: number,
): number {
  if (currentIndex < 0) {
    return serverIndex + 1;
  }
  return (serverIndex - currentIndex + totalServers) % totalServers;
}

export function selectAutoSwitchCandidates(
  servers: VlessConfig[],
  currentServer: VlessConfig,
  blockedServerIds: ReadonlySet<string>,
  options: AutoSwitchCandidateOptions = {},
): AutoSwitchSelection {
  if (servers.length === 0) {
    return { type: 'no-servers' };
  }

  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const now = options.now ?? Date.now();
  const freshPingMaxAgeMs =
    options.freshPingMaxAgeMs ?? DEFAULT_FRESH_PING_MAX_AGE_MS;
  const currentIndex = servers.findIndex(
    (server) => server.uuid === currentServer.uuid,
  );
  const availableServers = servers
    .map((server, index): RankedServer | null => {
      if (blockedServerIds.has(server.uuid)) {
        return null;
      }
      if (server.uuid === currentServer.uuid) {
        return null;
      }
      return {
        server,
        rank: getPingRank(server, now, freshPingMaxAgeMs),
        latency:
          typeof server.ping === 'number'
            ? server.ping
            : Number.POSITIVE_INFINITY,
        distance: getForwardDistance(index, currentIndex, servers.length),
      };
    })
    .filter((server): server is RankedServer => server !== null);

  if (availableServers.length === 0) {
    const currentIsAvailable =
      currentIndex >= 0 && !blockedServerIds.has(currentServer.uuid);
    return currentIsAvailable
      ? { type: 'same-server', server: currentServer }
      : { type: 'all-blocked' };
  }

  const candidates = availableServers
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.latency !== b.latency) return a.latency - b.latency;
      return a.distance - b.distance;
    })
    .slice(0, Math.max(1, maxCandidates))
    .map(({ server }) => server);

  return { type: 'selected-candidates', candidates };
}

export function selectNextServerForAutoSwitch(
  servers: VlessConfig[],
  currentServer: VlessConfig,
  blockedServerIds: ReadonlySet<string>,
): AutoSwitchSelection {
  const selection = selectAutoSwitchCandidates(
    servers,
    currentServer,
    blockedServerIds,
    {
      maxCandidates: 1,
    },
  );
  if (selection.type !== 'selected-candidates') {
    return selection;
  }
  return { type: 'selected', server: selection.candidates[0]! };
}
