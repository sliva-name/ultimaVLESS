import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRecoveryService } from './AppRecoveryService';

describe('AppRecoveryService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('blocks recovery after too many attempts in the bounded window', () => {
    const service = new AppRecoveryService();
    vi.setSystemTime(new Date('2026-04-03T10:00:00.000Z'));

    expect(
      service.beginRecovery('did-fail-load', 'did-fail-load').recoveryBlocked,
    ).toBe(false);
    expect(
      service.beginRecovery('render-process-gone', 'render-process-gone')
        .recoveryBlocked,
    ).toBe(false);
    expect(
      service.beginRecovery('did-fail-load', 'did-fail-load').recoveryBlocked,
    ).toBe(false);

    const blocked = service.beginRecovery(
      'render-process-gone',
      'render-process-gone',
    );
    expect(blocked.recoveryBlocked).toBe(true);
    expect(blocked.recoveryAttemptCount).toBe(3);
    expect(blocked.lastRecoveryTrigger).toBe('render-process-gone');
    expect(blocked.lastRecoveryOutcome).toBe('blocked');
  });

  it('allows recovery again after the retry window passes', () => {
    const service = new AppRecoveryService();
    const start = new Date('2026-04-03T10:00:00.000Z');
    vi.setSystemTime(start);

    service.beginRecovery('did-fail-load', 'did-fail-load');
    service.beginRecovery('render-process-gone', 'render-process-gone');
    service.beginRecovery('did-fail-load', 'did-fail-load');
    service.beginRecovery('render-process-gone', 'render-process-gone');

    vi.setSystemTime(new Date(start.getTime() + 61_000));

    const nextAttempt = service.beginRecovery('did-fail-load', 'did-fail-load');
    expect(nextAttempt.recoveryBlocked).toBe(false);
    expect(nextAttempt.recoveryAttemptCount).toBe(1);
  });

  it('records explicit recovery outcomes and fatal faults', () => {
    const service = new AppRecoveryService();
    vi.setSystemTime(new Date('2026-04-03T10:00:00.000Z'));

    service.beginRecovery('initial-load', 'initial-load failed');
    expect(service.completeRecovery('reloaded')).toMatchObject({
      recoveryInProgress: false,
      lastRecoveryOutcome: 'reloaded',
      lastRecoveryTrigger: 'initial-load',
    });

    expect(service.recordFatal('uncaught exception')).toMatchObject({
      lastRecoveryOutcome: 'fatal-exit-needed',
      lastFatalReason: 'uncaught exception',
    });
  });
});
