import { describe, expect, it } from 'vitest';
import { assertValidServerPayload, normalizeSavePayload } from './validators';

describe('normalizeSavePayload', () => {
  it('trims subscriptionUrl and manualLinks for object payload', () => {
    const result = normalizeSavePayload({
      subscriptionUrl: '  https://example.com/sub  ',
      manualLinks: '  vless://abc@example.com:443?type=tcp#Server  ',
    });

    expect(result).toEqual({
      subscriptionUrl: 'https://example.com/sub',
      manualLinks: 'vless://abc@example.com:443?type=tcp#Server',
    });
  });

  it('trims string payload format', () => {
    const result = normalizeSavePayload('  https://example.com/sub  ');
    expect(result).toEqual({
      subscriptionUrl: 'https://example.com/sub',
      manualLinks: '',
    });
  });

  it('rejects oversized subscriptionUrl in string payload', () => {
    const tooLongUrl = `https://example.com/${'a'.repeat(5000)}`;
    expect(() => normalizeSavePayload(tooLongUrl)).toThrow(/Subscription URL is too long/);
  });

  it('rejects oversized manualLinks payload', () => {
    const tooLargeManualLinks = 'vless://x@y:443#s\n'.repeat(70_000);
    expect(() =>
      normalizeSavePayload({
        subscriptionUrl: 'https://example.com/sub',
        manualLinks: tooLargeManualLinks,
      })
    ).toThrow(/Manual links payload is too large/);
  });
});

describe('assertValidServerPayload', () => {
  it('accepts valid server payload', () => {
    const result = assertValidServerPayload({
      uuid: 'abcdef12-3456',
      name: 'Server 1',
      address: 'example.com',
      port: 443,
    });

    expect(result.port).toBe(443);
  });

  it('rejects invalid port values', () => {
    expect(() =>
      assertValidServerPayload({
        uuid: 'abcdef12-3456',
        name: 'Server 1',
        address: 'example.com',
        port: 70000,
      })
    ).toThrow(/Invalid server payload/);
  });
});
