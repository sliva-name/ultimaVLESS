import { describe, expect, it, vi } from 'vitest';
import { parseJsonConfigs } from './jsonParsing';

vi.mock('@/main/services/LoggerService', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('parseJsonConfigs', () => {
  it('parses flat VLESS outbound (no vnext)', () => {
    const json = {
      remarks: 'Flat',
      outbounds: [
        {
          tag: 'proxy',
          protocol: 'vless',
          settings: {
            address: 'flat.example.com',
            port: 8443,
            id: '5783a3e7-e373-51cd-8642-c83782b807c5',
            encryption: 'none',
            flow: 'xtls-rprx-vision',
          },
          streamSettings: {
            network: 'raw',
            security: 'reality',
            realitySettings: {
              serverName: 'www.apple.com',
              fingerprint: 'chrome',
              password: 'PUBLIC_KEY_HEX',
              shortId: 'abcd',
            },
          },
        },
      ],
    };
    const [c] = parseJsonConfigs([json]);
    expect(c).toBeDefined();
    expect(c!.address).toBe('flat.example.com');
    expect(c!.port).toBe(8443);
    expect(c!.userId).toBe('5783a3e7-e373-51cd-8642-c83782b807c5');
    expect(c!.pbk).toBe('PUBLIC_KEY_HEX');
    expect(c!.type).toBe('raw');
    expect(c!.rawConfig).toEqual(json);
  });

  it('reads REALITY public key from password when publicKey absent', () => {
    const json = {
      remarks: 'Pwd key',
      outbounds: [
        {
          protocol: 'vless',
          settings: {
            vnext: [{ address: 'a.example.com', port: 443, users: [{ id: 'u1', encryption: 'none' }] }],
          },
          streamSettings: {
            network: 'tcp',
            security: 'reality',
            realitySettings: {
              serverName: 'sni.test',
              fingerprint: 'chrome',
              password: 'ONLY_PASSWORD_FIELD',
              shortId: '12ab',
            },
          },
        },
      ],
    };
    const [c] = parseJsonConfigs([json]);
    expect(c!.pbk).toBe('ONLY_PASSWORD_FIELD');
  });

  it('imports trojan JSON outbound with servers[]', () => {
    const json = {
      remarks: 'Trj',
      outbounds: [
        {
          tag: 'proxy',
          protocol: 'trojan',
          settings: { servers: [{ address: 'trojan.example.com', port: 443, password: 'secret-pass' }] },
          streamSettings: { network: 'tcp', security: 'tls', tlsSettings: { serverName: 'trojan.example.com' } },
        },
      ],
    };
    const [c] = parseJsonConfigs([json]);
    expect(c!.address).toBe('trojan.example.com');
    expect(c!.port).toBe(443);
    expect(c!.userId).toBeUndefined();
    expect(c!.rawConfig).toEqual(json);
  });

  it('keeps network raw in metadata', () => {
    const json = {
      outbounds: [
        {
          protocol: 'vless',
          settings: {
            vnext: [{ address: 'x.com', port: 443, users: [{ id: 'uuid', encryption: 'none' }] }],
          },
          streamSettings: { network: 'raw', security: 'none' },
        },
      ],
    };
    const [c] = parseJsonConfigs([json]);
    expect(c!.type).toBe('raw');
  });
});
