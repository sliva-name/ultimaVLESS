import type { VlessConfig } from '@/shared/types';
import { logger } from '@/main/services/LoggerService';
import { getAppStore } from '@/main/infrastructure/persistence/appStore';
import type { ServerRepository } from '@/main/domain/server/ServerRepository';

function catalogIdentityFingerprint(servers: VlessConfig[]): string {
  return servers
    .map(
      (server) =>
        `${server.uuid}|${server.name}|${server.address}:${server.port}|${server.protocol ?? ''}`,
    )
    .join('||');
}

function pingOverlayFingerprint(servers: VlessConfig[]): string {
  return servers
    .map(
      (server) =>
        `${server.uuid}|${server.ping ?? ''}|${server.pingTime ?? ''}|${server.pingStale ? 1 : 0}`,
    )
    .join('||');
}

function buildServersStoreFingerprint(servers: VlessConfig[]): string {
  return `${catalogIdentityFingerprint(servers)}##${pingOverlayFingerprint(servers)}`;
}

export function createServerRepository(): ServerRepository {
  const store = getAppStore();
  let lastPersistedFingerprint: string | null = null;

  return {
    get(id: string) {
      return store.get('servers').find((server) => server.uuid === id);
    },
    list() {
      return store.get('servers') || [];
    },
    saveAll(servers: VlessConfig[]) {
      const fingerprint = buildServersStoreFingerprint(servers);
      if (fingerprint === lastPersistedFingerprint) {
        logger.debug('ServerRepository', 'saveAll skipped (unchanged fingerprint)', {
          count: servers.length,
        });
        return;
      }
      lastPersistedFingerprint = fingerprint;
      logger.info('ServerRepository', 'saveAll', { count: servers.length });
      store.set('servers', servers);
    },
  };
}

let singleton: ServerRepository | null = null;

export function getServerRepository(): ServerRepository {
  singleton ??= createServerRepository();
  return singleton;
}
