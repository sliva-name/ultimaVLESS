import { EventEmitter } from '../node/events';
import type {
  CloseConflictingAppResult,
  ConflictingAppsScan,
  TunConflictCheck,
} from '@/shared/views/tunEnvironment';

const UNSUPPORTED_SCAN: ConflictingAppsScan = { supported: false, apps: [] };

/**
 * Android runs one VPN at a time and tells the current one when another
 * takes over (`revoked`), so there is nothing to scan for or close.
 */
export class ConflictingAppsService extends EventEmitter {
  public getTunCheck(): TunConflictCheck | null {
    return null;
  }

  public startTunCheck(): void {}

  public async scan(): Promise<ConflictingAppsScan> {
    return UNSUPPORTED_SCAN;
  }

  public async close(): Promise<CloseConflictingAppResult> {
    return { closed: false, remaining: [], scan: UNSUPPORTED_SCAN };
  }
}

export const conflictingAppsService = new ConflictingAppsService();
