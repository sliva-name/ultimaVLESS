import { describe, expect, it } from 'vitest';
import { SessionPolicyState } from './SessionPolicyState';

describe('SessionPolicyState', () => {
  it('owns the auto-switch toggle and blocked ledger', () => {
    const policy = new SessionPolicyState();
    expect(policy.getAutoSwitchingEnabled()).toBe(true);

    policy.setAutoSwitchingEnabled(false);
    policy.markBlocked('server-1', 1_000);
    expect(policy.getAutoSwitchingEnabled()).toBe(false);
    expect(policy.getBlockedServerIds(1_000)).toEqual(['server-1']);

    policy.clearBlocked();
    expect(policy.getBlockedServerIds(1_000)).toEqual([]);
  });

  it('expires blocked servers after the cooldown', () => {
    const policy = new SessionPolicyState();
    policy.markBlocked('server-1', 0);
    expect(policy.getBlockedServerIds(10 * 60 * 1000)).toEqual([]);
  });
});
