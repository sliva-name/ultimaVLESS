import type { VlessConfig } from '@/shared/types';
import { logger } from '@/main/services/LoggerService';
import { getAppStore } from '@/main/infrastructure/persistence/appStore';
import type { ServerRepository } from '@/main/domain/server/ServerRepository';
import {
  catalogListFingerprint,
  getServerConfigFingerprint,
  uniqueCatalogServers,
} from '@/shared/serverIdentity';

type StoredPing = {
  ping: number | null;
  pingTime?: number;
  pingStale?: boolean;
};

function pingOverlayFingerprint(overlay: Record<string, StoredPing>): string {
  return Object.entries(overlay)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([uuid, stored]) =>
        `${uuid}|${stored.ping ?? ''}|${stored.pingTime ?? ''}|${stored.pingStale ? 1 : 0}`,
    )
    .join('||');
}

function stripPing(server: VlessConfig): VlessConfig {
  const catalog = { ...server };
  delete catalog.ping;
  delete catalog.pingTime;
  delete catalog.pingStale;
  return catalog;
}

function extractPingOverlay(
  servers: VlessConfig[],
): Record<string, StoredPing> {
  const overlay: Record<string, StoredPing> = {};
  for (const server of servers) {
    if (
      server.ping === undefined &&
      server.pingTime === undefined &&
      server.pingStale === undefined
    ) {
      continue;
    }
    overlay[server.uuid] = {
      ping: server.ping ?? null,
      pingTime: server.pingTime,
      pingStale: server.pingStale,
    };
  }
  return overlay;
}

function hydratePingOverlay(
  catalog: VlessConfig[],
  overlay: Record<string, StoredPing>,
): VlessConfig[] {
  const previous = catalog.map((server) => {
    const stored = overlay[server.uuid];
    return stored ? { ...server, ...stored } : server;
  });
  const byFingerprint = new Map<string, StoredPing>();
  for (const server of previous) {
    if (
      server.ping === undefined &&
      server.pingTime === undefined &&
      server.pingStale === undefined
    ) {
      continue;
    }
    byFingerprint.set(getServerConfigFingerprint(server), {
      ping: server.ping ?? null,
      pingTime: server.pingTime,
      pingStale: server.pingStale,
    });
  }

  const unique = uniqueCatalogServers(catalog);
  return unique.map((server) => {
    const byUuid = overlay[server.uuid];
    if (byUuid) {
      return { ...server, ...byUuid };
    }
    const byFp = byFingerprint.get(getServerConfigFingerprint(server));
    return byFp ? { ...server, ...byFp } : server;
  });
}

export function createServerRepository(): ServerRepository {
  const store = getAppStore();
  let lastPersistedFingerprint: string | null = null;

  const readOverlay = (): Record<string, StoredPing> => {
    const stored = store.get('serverPings') ?? {};
    if (Object.keys(stored).length > 0) {
      return stored;
    }
    return extractPingOverlay(store.get('servers') || []);
  };

  return {
    get(id: string) {
      return this.list().find((server) => server.uuid === id);
    },
    list() {
      return hydratePingOverlay(store.get('servers') || [], readOverlay());
    },
    saveAll(servers: VlessConfig[]) {
      const unique = uniqueCatalogServers(servers);
      const catalog = unique.map(stripPing);
      const overlay = extractPingOverlay(unique);
      const fingerprint = `${catalogListFingerprint(catalog)}##${pingOverlayFingerprint(overlay)}`;
      if (fingerprint === lastPersistedFingerprint) {
        logger.debug(
          'ServerRepository',
          'saveAll skipped (unchanged fingerprint)',
          {
            count: servers.length,
          },
        );
        return;
      }
      lastPersistedFingerprint = fingerprint;
      logger.info('ServerRepository', 'saveAll', { count: servers.length });
      store.set('servers', catalog);
      store.set('serverPings', overlay);
    },
  };
}

let singleton: ServerRepository | null = null;

export function getServerRepository(): ServerRepository {
  singleton ??= createServerRepository();
  return singleton;
}
