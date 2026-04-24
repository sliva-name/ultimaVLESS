import { EventEmitter } from 'events';
import {
  AppRecoveryOutcome,
  AppRecoveryStatus,
  AppRecoveryTrigger,
} from '@/shared/ipc';

const RECOVERY_WINDOW_MS = 60_000;
const MAX_RECOVERY_ATTEMPTS = 3;

export class AppRecoveryService extends EventEmitter {
  private recoveryAttemptTimestamps: number[] = [];
  private status: AppRecoveryStatus = {
    recoveryInProgress: false,
    recoveryAttemptCount: 0,
    recoveryBlocked: false,
    lastRecoveryAt: null,
    lastRecoveryTrigger: null,
    lastRecoveryOutcome: null,
    lastRecoveryReason: null,
    lastFatalReason: null,
  };

  public beginRecovery(
    trigger: AppRecoveryTrigger,
    reason: string,
    now: number = Date.now(),
  ): AppRecoveryStatus {
    this.pruneAttempts(now);

    if (this.recoveryAttemptTimestamps.length >= MAX_RECOVERY_ATTEMPTS) {
      this.status = {
        ...this.status,
        recoveryInProgress: false,
        recoveryAttemptCount: this.recoveryAttemptTimestamps.length,
        recoveryBlocked: true,
        lastRecoveryTrigger: trigger,
        lastRecoveryOutcome: 'blocked',
        lastRecoveryReason: reason,
      };
      this.emitChange();
      return this.getStatus();
    }

    this.recoveryAttemptTimestamps.push(now);
    this.status = {
      recoveryInProgress: true,
      recoveryAttemptCount: this.recoveryAttemptTimestamps.length,
      recoveryBlocked: false,
      lastRecoveryAt: now,
      lastRecoveryTrigger: trigger,
      lastRecoveryOutcome: null,
      lastRecoveryReason: reason,
      lastFatalReason: null,
    };
    this.emitChange();
    return this.getStatus();
  }

  public completeRecovery(
    outcome: AppRecoveryOutcome = 'completed',
    now: number = Date.now(),
  ): AppRecoveryStatus {
    this.pruneAttempts(now);
    this.status = {
      ...this.status,
      recoveryInProgress: false,
      recoveryAttemptCount: this.recoveryAttemptTimestamps.length,
      recoveryBlocked:
        this.recoveryAttemptTimestamps.length >= MAX_RECOVERY_ATTEMPTS,
      lastRecoveryOutcome: outcome,
    };
    this.emitChange();
    return this.getStatus();
  }

  public recordFatal(
    reason: string,
    now: number = Date.now(),
  ): AppRecoveryStatus {
    this.pruneAttempts(now);
    this.status = {
      ...this.status,
      recoveryInProgress: false,
      lastRecoveryOutcome: 'fatal-exit-needed',
      lastRecoveryReason: reason,
      lastFatalReason: reason,
    };
    this.emitChange();
    return this.getStatus();
  }

  public getStatus(now: number = Date.now()): AppRecoveryStatus {
    this.pruneAttempts(now);
    return {
      ...this.status,
      recoveryAttemptCount: this.recoveryAttemptTimestamps.length,
      recoveryBlocked:
        this.status.recoveryBlocked &&
        this.recoveryAttemptTimestamps.length >= MAX_RECOVERY_ATTEMPTS,
    };
  }

  private pruneAttempts(now: number): void {
    this.recoveryAttemptTimestamps = this.recoveryAttemptTimestamps.filter(
      (timestamp) => now - timestamp <= RECOVERY_WINDOW_MS,
    );

    if (
      this.recoveryAttemptTimestamps.length < MAX_RECOVERY_ATTEMPTS &&
      this.status.recoveryBlocked
    ) {
      this.status = {
        ...this.status,
        recoveryBlocked: false,
      };
    }
  }

  private emitChange(): void {
    this.emit('changed', this.getStatus());
  }
}

export const appRecoveryService = new AppRecoveryService();
