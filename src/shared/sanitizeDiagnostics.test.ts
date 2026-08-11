import { describe, expect, it } from 'vitest';
import {
  REDACTED,
  sanitizeDiagnosticPayload,
  sanitizeSensitiveText,
} from './sanitizeDiagnostics';

describe('sanitizeSensitiveText', () => {
  it('redacts UUIDs and public IPv4 addresses', () => {
    const text =
      'connecting 11111111-2222-3333-4444-555555555555 via 203.0.113.7';
    const sanitized = sanitizeSensitiveText(text);
    expect(sanitized).not.toContain('11111111-2222');
    expect(sanitized).not.toContain('203.0.113.7');
  });

  it('keeps loopback and private IPv4 addresses', () => {
    const text = 'proxy 127.0.0.1:10808 gateway 192.168.1.1 lan 10.0.0.5';
    expect(sanitizeSensitiveText(text)).toBe(text);
  });

  it('redacts public IPv6 addresses', () => {
    expect(sanitizeSensitiveText('peer 2001:db8::dead:beef ok')).not.toContain(
      '2001:db8',
    );
  });

  it('keeps link-local and loopback IPv6, which matter for TUN diagnosis', () => {
    const text = 'tun fe80::1 dns ::1 ula fd00::5';
    expect(sanitizeSensitiveText(text)).toBe(text);
  });

  it('does not mangle clock times that look like IPv6 groups', () => {
    const text = '2026-08-11T19:56:36.123Z started at 19:56:36';
    expect(sanitizeSensitiveText(text)).toContain('19:56:36');
  });

  it('strips credentials embedded in a URL', () => {
    expect(sanitizeSensitiveText('https://bob:s3cret@example.com/sub')).toBe(
      'https://***:***@example.com/sub',
    );
  });
});

describe('sanitizeDiagnosticPayload', () => {
  it('redacts credential fields that no pattern could recognize', () => {
    const sanitized = sanitizeDiagnosticPayload({
      name: 'Server 1',
      port: 443,
      password: 'trojan-pass',
      pbk: 'reality-public-key',
      wgSecretKey: 'wg-private',
      shortId: 'ab12',
      nested: { apiToken: 'abc', keep: 'visible' },
    });

    expect(sanitized).toMatchObject({
      name: 'Server 1',
      port: 443,
      password: REDACTED,
      pbk: REDACTED,
      wgSecretKey: REDACTED,
      shortId: REDACTED,
      nested: { apiToken: REDACTED, keep: 'visible' },
    });
  });

  it('redacts secrets nested in arrays', () => {
    const sanitized = sanitizeDiagnosticPayload({
      peers: [{ endpoint: 'example.com:51820', preSharedKey: 'psk-value' }],
    });
    expect(sanitized.peers[0].preSharedKey).toBe(REDACTED);
    expect(sanitized.peers[0].endpoint).toBe('example.com:51820');
  });
});
