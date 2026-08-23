import type { VlessConfig } from '@/shared/types';
import { logger } from '@/main/services/LoggerService';
import { getAppStore } from '@/main/infrastructure/persistence/appStore';
import type { ServerRepository } from '@/main/domain/server/ServerRepository';

type StoredPing = {
  ping: number | null;
  pingTime?: number;
  pingStale?: boolean;
};

function catalogIdentityFingerprint(servers: VlessConfig[]): string {
  return servers
    .map(
      (server) =>
        `${server.uuid}|${server.name}|${server.address}:${server.port}|${server.protocol ?? ''}`,
    )
    .join('||');
}

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

function extractPingOverlay(servers: VlessConfig[]): Record<string, StoredPing> {
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

function applyPingOverlay(
  servers: VlessConfig[],
  overlay: Record<string, StoredPing>,
): VlessConfig[] {
  return servers.map((server) => {
    const stored = overlay[server.uuid];
    return stored ? { ...server, ...stored } : server;
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
      return applyPingOverlay(store.get('servers') || [], readOverlay());
    },
    saveAll(servers: VlessConfig[]) {
      const catalog = servers.map(stripPing);
      const overlay = extractPingOverlay(servers);
      const fingerprint = `${catalogIdentityFingerprint(catalog)}##${pingOverlayFingerprint(overlay)}`;
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
