import type { ConnectionMode, Subscription } from '@/shared/types';
import type { TrafficSnapshot } from './traffic';
import type { SafeServerConfig } from '@/shared/serverView';
import type {
  AppRecoveryStatus,
  ConnectionHealthState,
  XrayHealthStatus,
} from './monitorStatus';

export type { SafeServerConfig } from '@/shared/serverView';

/** Single UI session phase — owned by ConnectionManager. */
export type SessionPhase =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'switching'
  | 'disconnecting'
  | 'failed';

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

export interface AppHealthSnapshot {
  lastHealthState: ConnectionHealthState;
  lastHealthFailureReason: string | null;
  lastHealthCheckAt: number | null;
  localProxyReachable: boolean | null;
}

export interface AppSnapshot {
  servers: SafeServerConfig[];
  subscriptions: Subscription[];
  selectedServerId: string | null;
  connectionMode: ConnectionMode;
  session: AppSessionSnapshot;
  health: AppHealthSnapshot;
  process: XrayHealthStatus;
  recovery: AppRecoveryStatus;
  autoSwitchingEnabled: boolean;
  traffic: TrafficSnapshot | null;
}
