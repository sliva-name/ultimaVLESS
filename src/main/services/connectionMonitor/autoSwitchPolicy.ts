import type { VlessConfig } from '@/shared/types';

export type AutoSwitchSelection =
  | { type: 'selected'; server: VlessConfig }
  | { type: 'no-servers' }
  | { type: 'all-blocked' }
  | { type: 'same-server'; server: VlessConfig };

export function selectNextServerForAutoSwitch(
  servers: VlessConfig[],
  currentServer: VlessConfig,
  blockedServerIds: ReadonlySet<string>,
): AutoSwitchSelection {
  if (servers.length === 0) {
    return { type: 'no-servers' };
  }

  const availableServers = servers.filter(
    (server) => !blockedServerIds.has(server.uuid),
  );
  if (availableServers.length === 0) {
    return { type: 'all-blocked' };
  }

  const currentIndex = servers.findIndex(
    (server) => server.uuid === currentServer.uuid,
  );
  let nextServer: VlessConfig | null = null;

  if (currentIndex >= 0) {
    for (let i = 1; i < servers.length; i++) {
      const candidate = servers[(currentIndex + i) % servers.length];
      if (!blockedServerIds.has(candidate.uuid)) {
        nextServer = candidate;
        break;
      }
    }
  }

  nextServer ??= availableServers[0]!;
  if (nextServer.uuid === currentServer.uuid) {
    return { type: 'same-server', server: nextServer };
  }

  return { type: 'selected', server: nextServer };
}
