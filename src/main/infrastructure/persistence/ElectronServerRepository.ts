import type { VlessConfig } from '@/shared/types';
import { logger } from '@/main/services/LoggerService';
import { getAppStore } from '@/main/infrastructure/persistence/appStore';
import type {
  ServerPingOverlay,
  ServerRepository,
} from '@/main/domain/server/ServerRepository';
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
  /**
   * `electron-store` re-reads and re-parses the whole JSON file on every
   * `get()`. The catalog is read on every snapshot, every `get(id)` and every
   * partial ping persist, so keep the hydrated list in memory and drop it only
   * when this repository (the sole in-process writer of these keys) writes.
   */
  let cachedCatalog: VlessConfig[] | null = null;
  let cachedList: VlessConfig[] | null = null;

  const readCatalog = (): VlessConfig[] => {
    cachedCatalog ??= store.get('servers') || [];
    return cachedCatalog;
  };

  const readOverlay = (): Record<string, StoredPing> => {
    const stored = store.get('serverPings') ?? {};
    if (Object.keys(stored).length > 0) {
      return stored;
    }
    return extractPingOverlay(readCatalog());
  };

  const readList = (): VlessConfig[] => {
    cachedList ??= hydratePingOverlay(readCatalog(), readOverlay());
    return cachedList;
  };

  const invalidate = (): void => {
    cachedCatalog = null;
    cachedList = null;
  };

  return {
    get(id: string) {
      return readList().find((server) => server.uuid === id);
    },
    list() {
      // Fresh array so callers can filter/sort without touching the cache;
      // the row objects themselves are treated as immutable throughout.
      return [...readList()];
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
      invalidate();
    },
    savePings(overlay: ServerPingOverlay) {
      const catalog = readCatalog();
      const fingerprint = `${catalogListFingerprint(catalog)}##${pingOverlayFingerprint(overlay)}`;
      if (fingerprint === lastPersistedFingerprint) {
        logger.debug('ServerRepository', 'savePings skipped (unchanged)');
        return;
      }
      lastPersistedFingerprint = fingerprint;
      logger.debug('ServerRepository', 'savePings', {
        count: Object.keys(overlay).length,
      });
      store.set('serverPings', overlay);
      // Catalog rows are untouched; only the hydrated projection is stale.
      cachedList = null;
    },
  };
}

let singleton: ServerRepository | null = null;

export function getServerRepository(): ServerRepository {
  singleton ??= createServerRepository();
  return singleton;
}
