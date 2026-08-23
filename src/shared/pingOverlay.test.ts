import { describe, expect, it } from 'vitest';
import { applyPingOverlay, collectPingOverlay } from './pingOverlay';
import { makeServer } from '@/test/factories';

describe('pingOverlay', () => {
  it('reapplies latency by uuid, then by endpoint identity', () => {
    const stored = [
      makeServer({
        uuid: 'old-id',
        address: '1.2.3.4',
        ping: 18,
        pingTime: 50,
      }),
    ];
    const refreshed = [
      makeServer({ uuid: 'new-id', address: '1.2.3.4' }),
      makeServer({ uuid: 'other', address: '8.8.8.8' }),
    ];

    const merged = applyPingOverlay(refreshed, collectPingOverlay(stored));

    expect(merged[0]).toMatchObject({
      uuid: 'new-id',
      ping: 18,
      pingStale: true,
    });
    expect(merged[1]).toMatchObject({
      uuid: 'other',
      ping: null,
      pingStale: false,
    });
  });
});
