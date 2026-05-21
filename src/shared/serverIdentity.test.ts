import { describe, expect, it } from 'vitest';
import {
  createHashedIdentityToken,
  createStableServerId,
  getServerDedupKey,
  getServerEndpointKey,
  isSameServerIdentity,
} from './serverIdentity';
import { makeServer } from '@/test/factories';

describe('serverIdentity', () => {
  it('builds stable ids without exposing hashed secret input', () => {
    const token = createHashedIdentityToken(
      'tj',
      'super-secret-password',
      'vpn.example.com',
      443,
    );
    const id = createStableServerId(token, 'vpn.example.com', 443, [
      'tcp',
      'tls',
    ]);

    expect(token).toMatch(/^tj[0-9a-f]{14}$/);
    expect(id).toContain('vpn.example.com:443');
    expect(id).not.toContain('super-secret-password');
  });

  it('keeps dedup identity stricter than endpoint identity', () => {
    const first = makeServer({
      uuid: 'server-a',
      address: 'same.example.com',
      port: 443,
      path: '/one',
    });
    const second = makeServer({
      uuid: 'server-b',
      address: 'same.example.com',
      port: 443,
      path: '/two',
    });

    expect(getServerEndpointKey(first)).toBe(getServerEndpointKey(second));
    expect(getServerDedupKey(first)).not.toBe(getServerDedupKey(second));
    expect(isSameServerIdentity(first, second)).toBe(true);
  });
});
