import { describe, expect, it } from 'vitest';
import {
  assertAllowInsecureNotUsed,
  assertEncryptedPublicOutbound,
  assertSupportedShadowsocksMethod,
  isPrivateOrLocalEndpoint,
  normalizeVmessSecurity,
} from './outboundCompat';

describe('outboundCompat', () => {
  it('detects private and local endpoints', () => {
    expect(isPrivateOrLocalEndpoint('127.0.0.1')).toBe(true);
    expect(isPrivateOrLocalEndpoint('192.168.1.1')).toBe(true);
    expect(isPrivateOrLocalEndpoint('10.0.0.5')).toBe(true);
    expect(isPrivateOrLocalEndpoint('localhost')).toBe(true);
    expect(isPrivateOrLocalEndpoint('router.local')).toBe(true);
    expect(isPrivateOrLocalEndpoint('intranet')).toBe(true);
    expect(isPrivateOrLocalEndpoint('example.com')).toBe(false);
    expect(isPrivateOrLocalEndpoint('1.1.1.1')).toBe(false);
  });

  it('coerces removed VMess security values to auto', () => {
    expect(normalizeVmessSecurity('none')).toBe('auto');
    expect(normalizeVmessSecurity('zero')).toBe('auto');
    expect(normalizeVmessSecurity('aes-128-gcm')).toBe('aes-128-gcm');
  });

  it('rejects removed Shadowsocks methods', () => {
    expect(() => assertSupportedShadowsocksMethod('none')).toThrow(
      /removed in Xray/,
    );
    expect(() => assertSupportedShadowsocksMethod('plain')).toThrow(
      /removed in Xray/,
    );
    expect(() => assertSupportedShadowsocksMethod('aes-128-gcm')).not.toThrow();
  });

  it('rejects unencrypted public VLESS/Trojan outbounds', () => {
    expect(() =>
      assertEncryptedPublicOutbound({
        protocol: 'vless',
        address: 'example.com',
        streamSecurity: 'none',
        vlessEncryption: 'none',
      }),
    ).toThrow(/TLS\/REALITY/);

    expect(() =>
      assertEncryptedPublicOutbound({
        protocol: 'trojan',
        address: '1.1.1.1',
        streamSecurity: 'none',
      }),
    ).toThrow(/Trojan requires TLS/);

    expect(() =>
      assertEncryptedPublicOutbound({
        protocol: 'vless',
        address: 'example.com',
        streamSecurity: 'reality',
      }),
    ).not.toThrow();

    expect(() =>
      assertEncryptedPublicOutbound({
        protocol: 'vless',
        address: '192.168.0.10',
        streamSecurity: 'none',
      }),
    ).not.toThrow();
  });

  it('rejects allowInsecure', () => {
    expect(() => assertAllowInsecureNotUsed(true)).toThrow(/allowInsecure/);
    expect(() => assertAllowInsecureNotUsed(false)).not.toThrow();
  });
});
