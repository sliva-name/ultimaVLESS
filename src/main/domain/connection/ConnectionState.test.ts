import { describe, expect, it } from 'vitest';
import {
  activeServerIdFromState,
  connectionStateToSessionPhase,
  isConnectionStateInFlight,
  lastErrorFromState,
  type ConnectionState,
} from './ConnectionState';

describe('ConnectionState', () => {
  it('projects onto the existing SessionPhase UI contract', () => {
    const cases: Array<[ConnectionState, string]> = [
      [{ type: 'disconnected' }, 'idle'],
      [
        { type: 'starting', serverId: 'a', mode: 'proxy', generation: 1 },
        'connecting',
      ],
      [{ type: 'connected', serverId: 'a', mode: 'tun' }, 'connected'],
      [
        {
          type: 'switching',
          from: 'a',
          to: 'b',
          mode: 'proxy',
          generation: 2,
        },
        'switching',
      ],
      [{ type: 'stopping', generation: 3, outcome: 'idle' }, 'disconnecting'],
      [{ type: 'failed', reason: { message: 'boom' } }, 'failed'],
    ];

    for (const [state, phase] of cases) {
      expect(connectionStateToSessionPhase(state)).toBe(phase);
    }
  });

  it('treats only in-flight operations as busy', () => {
    expect(isConnectionStateInFlight({ type: 'disconnected' })).toBe(false);
    expect(
      isConnectionStateInFlight({
        type: 'starting',
        serverId: 'a',
        mode: 'proxy',
        generation: 1,
      }),
    ).toBe(true);
    expect(
      isConnectionStateInFlight({ type: 'connected', serverId: 'a', mode: 'proxy' }),
    ).toBe(false);
    expect(
      isConnectionStateInFlight({
        type: 'stopping',
        generation: 1,
        outcome: 'idle',
      }),
    ).toBe(true);
  });

  it('exposes the server the session is targeting', () => {
    expect(activeServerIdFromState({ type: 'disconnected' })).toBeNull();
    expect(
      activeServerIdFromState({
        type: 'switching',
        from: 'a',
        to: 'b',
        mode: 'proxy',
        generation: 1,
      }),
    ).toBe('b');
  });

  it('exposes lastError only from failed or failing stop', () => {
    expect(lastErrorFromState({ type: 'disconnected' })).toBeNull();
    expect(
      lastErrorFromState({ type: 'failed', reason: { message: 'boom' } }),
    ).toBe('boom');
    expect(
      lastErrorFromState({
        type: 'stopping',
        generation: 1,
        outcome: 'failed',
        reason: { message: 'dead' },
      }),
    ).toBe('dead');
    expect(
      lastErrorFromState({
        type: 'stopping',
        generation: 1,
        outcome: 'idle',
      }),
    ).toBeNull();
  });
});
