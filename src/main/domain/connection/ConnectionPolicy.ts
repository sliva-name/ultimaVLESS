import type { VlessConfig } from '@/shared/types';
import { selectAutoSwitchCandidates } from '@/main/services/connectionMonitor/autoSwitchPolicy';
import { isServerPublicOutboundCompatible } from '@/main/services/configGenerator/outboundCompat';

export type PolicyDecision =
  | { action: 'switch'; candidates: VlessConfig[] }
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
        {
          maxCandidates: AUTO_SWITCH_CANDIDATE_LIMIT,
          isEligible: isServerPublicOutboundCompatible,
        },
      );

      if (selection.type === 'selected-candidates') {
        return { action: 'switch', candidates: selection.candidates };
      }
      return { action: 'disconnect' };
    },
  };
}
