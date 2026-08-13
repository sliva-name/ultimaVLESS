import type { VlessConfig } from '@/shared/types';

export interface ServerRepository {
  get(id: string): VlessConfig | undefined;
  list(): VlessConfig[];
  saveAll(servers: VlessConfig[]): void;
}
