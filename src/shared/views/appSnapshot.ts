import type { ConnectionMode, Subscription } from '@/shared/types';
import type { TrafficSnapshot } from './traffic';
import type { SafeServerConfig } from '@/shared/serverView';

export type { SafeServerConfig } from '@/shared/serverView';

/** Single UI/controller session phase — owned by ConnectionController. */
export type SessionPhase =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'switching'
  | 'disconnecting'
  | 'failed';

/** @deprecated Use SessionPhase */
export type AppSessionStatus = SessionPhase;

export function isSessionPhaseInFlight(phase: SessionPhase): boolean {
  return (
    phase === 'connecting' ||
    phase === 'disconnecting' ||
    phase === 'switching'
  );
}

export interface AppSessionSnapshot {
  phase: SessionPhase;
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
