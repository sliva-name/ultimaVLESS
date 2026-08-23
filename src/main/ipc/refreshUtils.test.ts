import { describe, expect, it } from 'vitest';
import { preserveActiveServerIfNeeded } from './refreshUtils';
import { makeServer } from '@/test/factories';

describe('preserveActiveServerIfNeeded', () => {
  it('keeps the live session server when refresh omits it', () => {
    const live = makeServer({ uuid: 'live', name: 'Live', address: '9.9.9.9' });
    const next = makeServer({ uuid: 'new', name: 'New', address: '1.2.3.4' });

    const merged = preserveActiveServerIfNeeded([next], [live, next], 'live');

    expect(merged.map((server) => server.uuid)).toEqual(['live', 'new']);
  });

  it('does not invent a live server from monitor-less state', () => {
    const next = makeServer({ uuid: 'new' });
    expect(preserveActiveServerIfNeeded([next], [next], null)).toEqual([next]);
  });

  it('keeps an unmatched selected server', () => {
    const selected = makeServer({ uuid: 'picked', address: '9.9.9.9' });
    const next = makeServer({ uuid: 'new', address: '1.2.3.4' });

    const merged = preserveActiveServerIfNeeded(
      [next],
      [selected],
      null,
      'picked',
    );

    expect(merged.map((server) => server.uuid)).toEqual(['picked', 'new']);
  });

  it('does not duplicate a live server already represented by identity', () => {
    const live = makeServer({ uuid: 'old-id', address: '1.2.3.4' });
    const rotated = makeServer({ uuid: 'new-id', address: '1.2.3.4' });

    expect(
      preserveActiveServerIfNeeded([rotated], [live], 'old-id').map(
        (server) => server.uuid,
      ),
    ).toEqual(['new-id']);
  });
});
