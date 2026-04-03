import { describe, expect, it } from 'vitest';
import { assertConnectionMode, assertValidServerPayload, normalizeSavePayload, redactUrl } from './validators';

describe('normalizeSavePayload', () => {
  it.each([
    {
      input: {
        subscriptionUrl: '  https://example.com/sub  ',
        manualLinks: '  vless://abc@example.com:443?type=tcp#Server  ',
      },
      expected: {
        subscriptionUrl: 'https://example.com/sub',
        manualLinks: 'vless://abc@example.com:443?type=tcp#Server',
      },
    },
    {
      input: '  https://example.com/sub  ',
      expected: {
        subscriptionUrl: 'https://example.com/sub',
        manualLinks: '',
      },
    },
  ])('normalizes valid payloads: $expected.subscriptionUrl', ({ input, expected }) => {
    expect(normalizeSavePayload(input)).toEqual(expected);
  });

  it('rejects oversized subscription urls', () => {
    expect(() => normalizeSavePayload(`https://example.com/${'a'.repeat(5000)}`)).toThrow(
      /Subscription URL is too long/
    );
  });

  it('rejects oversized manual links payloads', () => {
    expect(() =>
      normalizeSavePayload({
        subscriptionUrl: 'https://example.com/sub',
        manualLinks: 'vless://x@y:443#s\n'.repeat(70_000),
      })
    ).toThrow(/Manual links payload is too large/);
  });
});

describe('assertValidServerPayload', () => {
  it('accepts valid server payloads', () => {
    expect(
      assertValidServerPayload({
        uuid: 'abcdef12-3456',
        name: 'Server 1',
        address: 'example.com',
        port: 443,
      })
    ).toMatchObject({ port: 443, address: 'example.com' });
  });

  it.each([
    { port: 70000 },
    { port: 0 },
    { port: 443.5 },
  ])('rejects invalid port values: $port', ({ port }) => {
    expect(() =>
      assertValidServerPayload({
        uuid: 'abcdef12-3456',
        name: 'Server 1',
        address: 'example.com',
        port,
      } as any)
    ).toThrow(/Invalid server payload/);
  });
});

describe('assertConnectionMode', () => {
  it.each(['proxy', 'tun'] as const)('accepts %s', (mode) => {
    expect(assertConnectionMode(mode)).toBe(mode);
  });

  it.each(['bridge', null])('rejects invalid mode %s', (mode) => {
    expect(() => assertConnectionMode(mode)).toThrow(/Invalid connection mode/);
  });
});

describe('redactUrl', () => {
  it.each([
    ['https://example.com/path?q=secret#frag', 'https://example.com/path'],
    ['not-a-url', '[invalid-url]'],
  ])('redacts %s', (value, expected) => {
    expect(redactUrl(value)).toBe(expected);
  });
});
