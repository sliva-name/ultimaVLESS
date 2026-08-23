import { describe, expect, it } from 'vitest';
import { preserveActiveServerIfNeeded } from './refreshUtils';
import { makeServer } from '@/test/factories';

describe('preserveActiveServerIfNeeded', () => {
  it('keeps the live session server when refresh omits it', () => {
    const live = makeServer({ uuid: 'live', name: 'Live' });
    const next = makeServer({ uuid: 'new', name: 'New' });

    const merged = preserveActiveServerIfNeeded([next], [live, next], 'live');

    expect(merged.map((server) => server.uuid)).toEqual(['live', 'new']);
  });

  it('does not invent a live server from monitor-less state', () => {
    const next = makeServer({ uuid: 'new' });
    expect(preserveActiveServerIfNeeded([next], [next], null)).toEqual([next]);
  });

  it('keeps an unmatched selected server', () => {
    const selected = makeServer({ uuid: 'picked' });
    const next = makeServer({ uuid: 'new' });

    const merged = preserveActiveServerIfNeeded(
      [next],
      [selected],
      null,
      'picked',
    );

    expect(merged.map((server) => server.uuid)).toEqual(['picked', 'new']);
  });
});
