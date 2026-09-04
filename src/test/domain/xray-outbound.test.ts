import { describe, expect, it } from 'vitest';
import {
  assertAllowInsecureNotUsed,
  assertEncryptedPublicOutbound,
  assertSupportedShadowsocksMethod,
  isPrivateOrLocalEndpoint,
  isServerPublicOutboundCompatible,
  normalizeVmessSecurity,
  requiresPublicTrojanMux,
} from '@/main/services/configGenerator/outboundCompat';
import { makeServer } from '@/test/factories';
import type { XrayConfig } from '@/shared/xray-types';

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

  it('requires TLS for public Hysteria outbounds', () => {
    expect(() =>
      assertEncryptedPublicOutbound({
        protocol: 'hysteria',
        address: 'example.com',
        streamSecurity: 'none',
      }),
    ).toThrow(/Hysteria requires/);

    expect(() =>
      assertEncryptedPublicOutbound({
        protocol: 'hysteria',
        address: 'example.com',
        streamSecurity: 'tls',
      }),
    ).not.toThrow();
  });

  it('rejects allowInsecure', () => {
    expect(() => assertAllowInsecureNotUsed(true)).toThrow(/allowInsecure/);
    expect(() => assertAllowInsecureNotUsed(false)).not.toThrow();
  });

  it('requires Mux for public Trojan addresses only', () => {
    expect(requiresPublicTrojanMux('example.com')).toBe(true);
    expect(requiresPublicTrojanMux('192.168.0.10')).toBe(false);
  });

  it('classifies catalog servers with the same public-outbound rules as generation', () => {
    expect(
      isServerPublicOutboundCompatible(
        makeServer({
          protocol: 'vless',
          address: '1.2.3.4',
          security: 'none',
        }),
      ),
    ).toBe(false);
    expect(
      isServerPublicOutboundCompatible(
        makeServer({
          protocol: 'vless',
          address: 'example.com',
          security: 'reality',
        }),
      ),
    ).toBe(true);
    expect(
      isServerPublicOutboundCompatible(
        makeServer({
          protocol: 'vless',
          address: '192.168.0.10',
          security: 'none',
        }),
      ),
    ).toBe(true);
    expect(
      isServerPublicOutboundCompatible(
        makeServer({
          protocol: 'vless',
          address: 'example.com',
          security: 'none',
          encryption: 'mlkem768x25519plus',
        }),
      ),
    ).toBe(true);
  });

  it('prefers raw outbound stream security over structured fields', () => {
    expect(
      isServerPublicOutboundCompatible(
        makeServer({
          address: 'example.com',
          security: 'tls',
          rawConfig: {
            outbounds: [
              {
                tag: 'proxy',
                protocol: 'vless',
                settings: { address: '1.2.3.4', encryption: 'none' },
                streamSettings: { network: 'tcp', security: 'none' },
              },
            ],
          } as XrayConfig,
        }),
      ),
    ).toBe(false);
    expect(
      isServerPublicOutboundCompatible(
        makeServer({
          address: '1.2.3.4',
          security: 'none',
          rawConfig: {
            outbounds: [
              {
                tag: 'proxy',
                protocol: 'vless',
                settings: { address: 'example.com', encryption: 'none' },
                streamSettings: { network: 'tcp', security: 'reality' },
              },
            ],
          } as XrayConfig,
        }),
      ),
    ).toBe(true);
  });
});
