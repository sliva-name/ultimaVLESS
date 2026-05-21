import { describe, expect, it } from 'vitest';
import { makeServer } from '@/test/factories';
import { selectNextServerForAutoSwitch } from './autoSwitchPolicy';

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
});
