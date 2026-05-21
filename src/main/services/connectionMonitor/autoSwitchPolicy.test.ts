import { describe, expect, it } from 'vitest';
import { makeServer } from '@/test/factories';
import {
  selectAutoSwitchCandidates,
  selectNextServerForAutoSwitch,
} from './autoSwitchPolicy';

describe('selectNextServerForAutoSwitch', () => {
  it('selects the next unblocked server after the current one', () => {
    const first = makeServer({ uuid: 'first' });
    const second = makeServer({ uuid: 'second' });
    const third = makeServer({ uuid: 'third' });

    expect(
      selectNextServerForAutoSwitch(
        [first, second, third],
        first,
        new Set(['second']),
      ),
    ).toEqual({ type: 'selected', server: third });
  });

  it('reports all-blocked and no-servers states explicitly', () => {
    const current = makeServer({ uuid: 'current' });

    expect(selectNextServerForAutoSwitch([], current, new Set())).toEqual({
      type: 'no-servers',
    });
    expect(
      selectNextServerForAutoSwitch([current], current, new Set(['current'])),
    ).toEqual({ type: 'all-blocked' });
  });

  it('does not select the current server as a replacement', () => {
    const current = makeServer({ uuid: 'current' });

    expect(
      selectNextServerForAutoSwitch([current], current, new Set()),
    ).toEqual({
      type: 'same-server',
      server: current,
    });
  });

  it('ranks fresh positive ping before stale ping and list order', () => {
    const now = Date.now();
    const current = makeServer({ uuid: 'current' });
    const nextByOrder = makeServer({ uuid: 'next-by-order' });
    const staleFast = makeServer({
      uuid: 'stale-fast',
      ping: 3,
      pingTime: now - 60_000,
      pingStale: true,
    });
    const freshSlower = makeServer({
      uuid: 'fresh-slower',
      ping: 30,
      pingTime: now - 1_000,
      pingStale: false,
    });

    expect(
      selectAutoSwitchCandidates(
        [current, nextByOrder, staleFast, freshSlower],
        current,
        new Set(),
        { now },
      ),
    ).toEqual({
      type: 'selected-candidates',
      candidates: [freshSlower, staleFast, nextByOrder],
    });
  });

  it('limits ranked candidates and excludes blocked servers', () => {
    const now = Date.now();
    const current = makeServer({ uuid: 'current' });
    const first = makeServer({ uuid: 'first', ping: 10, pingTime: now });
    const second = makeServer({ uuid: 'second', ping: 20, pingTime: now });
    const third = makeServer({ uuid: 'third', ping: 30, pingTime: now });

    expect(
      selectAutoSwitchCandidates(
        [current, first, second, third],
        current,
        new Set(['first']),
        { maxCandidates: 1, now },
      ),
    ).toEqual({
      type: 'selected-candidates',
      candidates: [second],
    });
  });
});
