import type { VlessConfig } from '@/shared/types';
import { selectAutoSwitchCandidates } from '@/main/services/connectionMonitor/autoSwitchPolicy';

export type PolicyDecision =
  | { action: 'switch'; candidates: VlessConfig[] }
  | { action: 'retry'; delayMs: number }
  | { action: 'disconnect' }
  | { action: 'none' };

export interface HealthContext {
  server: VlessConfig;
  reason: string;
  blocking: boolean;
  autoSwitchEnabled: boolean;
  servers: VlessConfig[];
  blockedServerIds: ReadonlySet<string>;
}

const AUTO_SWITCH_CANDIDATE_LIMIT = 30;

export interface ConnectionPolicy {
  onHealthFailure(context: HealthContext): PolicyDecision;
}

export function createAutoSwitchPolicy(): ConnectionPolicy {
  return {
    onHealthFailure(context: HealthContext): PolicyDecision {
      if (!context.blocking) {
        return { action: 'none' };
      }
      if (!context.autoSwitchEnabled) {
        return { action: 'disconnect' };
      }

      const selection = selectAutoSwitchCandidates(
        context.servers,
        context.server,
        context.blockedServerIds,
        { maxCandidates: AUTO_SWITCH_CANDIDATE_LIMIT },
      );

      if (selection.type === 'selected-candidates') {
        return { action: 'switch', candidates: selection.candidates };
      }
      if (selection.type === 'selected') {
        return { action: 'switch', candidates: [selection.server] };
      }
      return { action: 'disconnect' };
    },
  };
}
