import type { VlessConfig } from '@/shared/types';
import type { ConfigService } from '@/main/services/ConfigService';

export interface ServerRepository {
  get(id: string): VlessConfig | undefined;
  list(): VlessConfig[];
}

export function createConfigServerRepository(
  configService: Pick<ConfigService, 'getServers'>,
): ServerRepository {
  return {
    get(id: string): VlessConfig | undefined {
      return configService.getServers().find((server) => server.uuid === id);
    },
    list(): VlessConfig[] {
      return configService.getServers();
    },
  };
}
