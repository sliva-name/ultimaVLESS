import { describe, expect, it } from 'vitest';
import { makeServer } from '@/test/factories';
import { createAutoSwitchPolicy } from './ConnectionPolicy';

describe('ConnectionPolicy', () => {
  const policy = createAutoSwitchPolicy();

  it('ignores non-blocking health failures', () => {
    const server = makeServer({ uuid: 'a' });
    expect(
      policy.onHealthFailure({
        server,
        reason: 'slow',
        blocking: false,
        autoSwitchEnabled: true,
        servers: [server, makeServer({ uuid: 'b' })],
        blockedServerIds: new Set(),
      }),
    ).toEqual({ action: 'none' });
  });

  it('disconnects when auto-switch is disabled', () => {
    const server = makeServer({ uuid: 'a' });
    expect(
      policy.onHealthFailure({
        server,
        reason: 'blocked',
        blocking: true,
        autoSwitchEnabled: false,
        servers: [server, makeServer({ uuid: 'b' })],
        blockedServerIds: new Set(),
      }),
    ).toEqual({ action: 'disconnect' });
  });

  it('switches to ranked candidates when auto-switch is enabled', () => {
    const current = makeServer({ uuid: 'a', ping: 200 });
    const next = makeServer({ uuid: 'b', ping: 20 });
    const decision = policy.onHealthFailure({
      server: current,
      reason: 'blocked',
      blocking: true,
      autoSwitchEnabled: true,
      servers: [current, next],
      blockedServerIds: new Set(),
    });
    expect(decision).toEqual({
      action: 'switch',
      candidates: [next],
    });
  });

  it('disconnects when every alternative is blocked', () => {
    const current = makeServer({ uuid: 'a' });
    const other = makeServer({ uuid: 'b' });
    expect(
      policy.onHealthFailure({
        server: current,
        reason: 'blocked',
        blocking: true,
        autoSwitchEnabled: true,
        servers: [current, other],
        blockedServerIds: new Set(['a', 'b']),
      }),
    ).toEqual({ action: 'disconnect' });
  });
});
