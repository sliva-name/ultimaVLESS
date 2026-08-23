import type { SessionPhase } from '@/shared/ipc';
import type { ConnectionMode } from '@/shared/types';

export interface ConnectionError {
  message: string;
}

/**
 * Single owner-of-truth for VPN session lifecycle.
 * SessionPhase remains the UI projection of this state.
 */
export type ConnectionState =
  | { type: 'disconnected' }
  | {
      type: 'starting';
      serverId: string;
      mode: ConnectionMode;
      generation: number;
    }
  | { type: 'connected'; serverId: string; mode: ConnectionMode }
  | {
      type: 'switching';
      from: string;
      to: string;
      mode: ConnectionMode;
      generation: number;
    }
  | {
      type: 'stopping';
      generation: number;
      outcome: 'idle' | 'failed';
      reason?: ConnectionError;
    }
  | { type: 'failed'; reason: ConnectionError };

export function connectionStateToSessionPhase(
  state: ConnectionState,
): SessionPhase {
  switch (state.type) {
    case 'disconnected':
      return 'idle';
    case 'starting':
      return 'connecting';
    case 'connected':
      return 'connected';
    case 'switching':
      return 'switching';
    case 'stopping':
      return 'disconnecting';
    case 'failed':
      return 'failed';
  }
}

export function isConnectionStateInFlight(state: ConnectionState): boolean {
  return (
    state.type === 'starting' ||
    state.type === 'switching' ||
    state.type === 'stopping'
  );
}

export function lastErrorFromState(state: ConnectionState): string | null {
  if (state.type === 'failed') {
    return state.reason.message;
  }
  if (state.type === 'stopping' && state.outcome === 'failed') {
    return state.reason?.message ?? null;
  }
  return null;
}

export function activeServerIdFromState(state: ConnectionState): string | null {
  switch (state.type) {
    case 'starting':
    case 'connected':
      return state.serverId;
    case 'switching':
      return state.to;
    default:
      return null;
  }
}
