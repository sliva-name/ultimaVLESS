import type { VlessConfig } from '@/shared/types';

export type ServerPingOverlay = Record<
  string,
  { ping: number | null; pingTime?: number; pingStale?: boolean }
>;

export interface ServerRepository {
  get(id: string): VlessConfig | undefined;
  list(): VlessConfig[];
  saveAll(servers: VlessConfig[]): void;
  /** Write only the ping overlay; leave the catalog rows untouched. */
  savePings?(overlay: ServerPingOverlay): void;
}
