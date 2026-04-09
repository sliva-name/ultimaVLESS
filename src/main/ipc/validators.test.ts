import { describe, expect, it } from 'vitest';
import {
  assertConnectionMode,
  assertValidServerPayload,
  normalizeAddSubscriptionPayload,
  normalizeManualLinks,
  normalizeUpdateSubscriptionPayload,
  redactUrl,
} from './validators';

describe('normalizeAddSubscriptionPayload', () => {
  it('normalizes a valid payload', () => {
    expect(
      normalizeAddSubscriptionPayload({ name: '  My Sub  ', url: '  https://example.com/sub  ' })
    ).toEqual({ name: 'My Sub', url: 'https://example.com/sub' });
  });

  it('rejects missing name', () => {
    expect(() => normalizeAddSubscriptionPayload({ name: '', url: 'https://example.com' })).toThrow(/name is required/);
  });

  it('rejects missing url', () => {
    expect(() => normalizeAddSubscriptionPayload({ name: 'Test', url: '' })).toThrow(/URL is required/);
  });

  it('rejects oversized URL', () => {
    expect(() =>
      normalizeAddSubscriptionPayload({ name: 'Test', url: `https://example.com/${'a'.repeat(5000)}` })
    ).toThrow(/URL is too long/);
  });

  it('rejects non-object payload', () => {
    expect(() => normalizeAddSubscriptionPayload('https://example.com')).toThrow(/Invalid subscription payload/);
  });
});

describe('normalizeUpdateSubscriptionPayload', () => {
  it('normalizes a valid patch', () => {
    expect(
      normalizeUpdateSubscriptionPayload({ id: 'abc', name: '  Updated  ', enabled: false })
    ).toEqual({ id: 'abc', patch: { name: 'Updated', enabled: false } });
  });

  it('reads name, url, enabled from nested patch (renderer shape)', () => {
    expect(
      normalizeUpdateSubscriptionPayload({
        id: 'sub-1',
        patch: { enabled: false },
      })
    ).toEqual({ id: 'sub-1', patch: { enabled: false } });
    expect(
      normalizeUpdateSubscriptionPayload({
        id: 'sub-1',
        patch: { name: '  New  ', url: '  https://x.test/sub  ' },
      })
    ).toEqual({ id: 'sub-1', patch: { name: 'New', url: 'https://x.test/sub' } });
  });

  it('flat fields override nested patch when both present', () => {
    expect(
      normalizeUpdateSubscriptionPayload({
        id: 'sub-1',
        patch: { enabled: true },
        enabled: false,
      })
    ).toEqual({ id: 'sub-1', patch: { enabled: false } });
  });

  it('rejects missing id', () => {
    expect(() => normalizeUpdateSubscriptionPayload({ id: '', name: 'Test' })).toThrow(/id is required/);
  });
});

describe('normalizeManualLinks', () => {
  it('trims and returns string', () => {
    expect(normalizeManualLinks('  vless://abc@x:443#s  ')).toBe('vless://abc@x:443#s');
  });

  it('rejects oversized payload', () => {
    expect(() => normalizeManualLinks('vless://x@y:443#s\n'.repeat(70_000))).toThrow(
      /Manual links payload is too large/
    );
  });

  it('rejects non-string', () => {
    expect(() => normalizeManualLinks({ text: 'links' })).toThrow(/Invalid manual links payload/);
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
