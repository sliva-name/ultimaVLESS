import { describe, expect, it } from 'vitest';
import {
  createStableServerId,
  getServerEndpointKey,
  isSameServerIdentity,
} from './serverIdentity';
import { toSafeServer } from './serverView';
import { makeServer } from '@/test/factories';

describe('shared architecture contracts', () => {
  it('creates deterministic server identities from auth and endpoint data', () => {
    const first = createStableServerId('user-id', 'example.com', 443, [
      'tcp',
      'reality',
    ]);
    const second = createStableServerId('user-id', 'example.com', 443, [
      'tcp',
      'reality',
    ]);

    expect(first).toBe(second);
    expect(first).toContain('example.com:443');
  });

  it('uses endpoint identity as the refresh-tolerant fallback', () => {
    const current = makeServer({ uuid: 'old-id', address: '1.2.3.4' });
    const refreshed = makeServer({ uuid: 'new-id', address: '1.2.3.4' });

    expect(getServerEndpointKey(current)).toBe('vless|1.2.3.4:443');
    expect(isSameServerIdentity(current, refreshed)).toBe(true);
  });

  it('strips raw Xray config from renderer-facing server views', () => {
    const safe = toSafeServer(
      makeServer({
        rawConfig: {
          inbounds: [],
          outbounds: [{ tag: 'proxy', protocol: 'vless', settings: {} }],
        },
      }),
    );

    expect('rawConfig' in safe).toBe(false);
  });
});
