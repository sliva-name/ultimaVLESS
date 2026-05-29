import type { ConnectionMode, Subscription, VlessConfig } from '@/shared/types';
import type { TrafficSnapshot } from './traffic';

export type SafeServerConfig = Omit<VlessConfig, 'rawConfig'>;

export type AppSessionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'switching'
  | 'disconnecting'
  | 'failed';

export interface AppSessionSnapshot {
  status: AppSessionStatus;
  busy: boolean;
  activeServerId: string | null;
  lastError: string | null;
  blockedServerIds: string[];
}

export interface AppSnapshot {
  servers: SafeServerConfig[];
  subscriptions: Subscription[];
  selectedServerId: string | null;
  connectionMode: ConnectionMode;
  session: AppSessionSnapshot;
  traffic: TrafficSnapshot | null;
}
