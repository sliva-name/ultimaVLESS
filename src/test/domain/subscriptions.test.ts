import { describe, expect, it } from 'vitest';
import { parseDirectLinksFromText } from '@/main/services/subscription/linkParsing';
import { parseJsonConfigs } from '@/main/services/subscription/jsonParsing';

describe('subscription parsing', () => {
  it('extracts VLESS links from mixed clipboard text', () => {
    const configs = parseDirectLinksFromText(
      'hello vless://user-id@example.com:443?security=reality&sni=example.com&pbk=key#Demo',
    );

    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({
      address: 'example.com',
      port: 443,
      name: 'Demo',
      security: 'reality',
    });
  });

  it('defaults to port 443 when a VLESS link omits the port', () => {
    const configs = parseDirectLinksFromText(
      'vless://user-id@example.com?security=tls&sni=example.com#NoPort',
    );

    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({
      address: 'example.com',
      port: 443,
      name: 'NoPort',
    });
  });

  it('maps type=splithttp transport from VLESS links', () => {
    const configs = parseDirectLinksFromText(
      'vless://user-id@example.com:443?type=splithttp&security=tls#SplitHttp',
    );

    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({ type: 'splithttp' });
  });

  it('keeps raw JSON configs available for the compiler path', () => {
    const [config] = parseJsonConfigs([
      {
        remarks: 'Raw',
        outbounds: [
          {
            tag: 'proxy',
            protocol: 'vless',
            settings: {
              vnext: [
                {
                  address: 'raw.example.com',
                  port: 443,
                  users: [{ id: 'user-id', encryption: 'none' }],
                },
              ],
            },
            streamSettings: { network: 'tcp', security: 'none' },
          },
        ],
      },
    ]);

    expect(config).toMatchObject({
      name: 'Raw',
      address: 'raw.example.com',
      rawConfig: expect.any(Object),
    });
  });

  it('parses hy2:// Hysteria2 links', () => {
    const configs = parseDirectLinksFromText(
      'hy2://secret@hy.example.com:443?sni=hy.example.com&obfs=salamander&obfs-password=pass&ech=echblob&pinSHA256=ABCD#Hy2',
    );

    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({
      protocol: 'hysteria',
      address: 'hy.example.com',
      port: 443,
      name: 'Hy2',
      hysteriaAuth: 'secret',
      type: 'hysteria',
      security: 'tls',
      sni: 'hy.example.com',
      echConfigList: 'echblob',
      pinnedPeerCertSha256: 'ABCD',
      hysteriaObfs: { type: 'salamander', password: 'pass' },
    });
  });

  it('maps optional VLESS pqv/ech query params', () => {
    const configs = parseDirectLinksFromText(
      'vless://user-id@example.com:443?security=reality&sni=example.com&pbk=key&pqv=pqkey&ech=echblob#PQ',
    );

    expect(configs[0]).toMatchObject({
      mldsa65Verify: 'pqkey',
      echConfigList: 'echblob',
    });
  });

  it('parses hysteria and wireguard JSON outbounds', () => {
    const [hy] = parseJsonConfigs([
      {
        remarks: 'Hy JSON',
        outbounds: [
          {
            tag: 'proxy',
            protocol: 'hysteria',
            settings: {
              version: 2,
              address: 'hy.example.com',
              port: 443,
            },
            streamSettings: {
              method: 'hysteria',
              security: 'tls',
              hysteriaSettings: { version: 2, auth: 'token' },
              tlsSettings: {
                serverName: 'hy.example.com',
                echConfigList: 'ech',
              },
              finalmask: {
                udp: [
                  {
                    type: 'salamander',
                    settings: { password: 'obfs' },
                  },
                ],
              },
            },
          },
        ],
      },
    ]);
    expect(hy).toMatchObject({
      protocol: 'hysteria',
      hysteriaAuth: 'token',
      echConfigList: 'ech',
      hysteriaObfs: { type: 'salamander', password: 'obfs' },
    });

    const [wg] = parseJsonConfigs([
      {
        remarks: 'WG JSON',
        outbounds: [
          {
            tag: 'proxy',
            protocol: 'wireguard',
            settings: {
              secretKey: 'sk',
              address: ['10.0.0.2/32'],
              peers: [
                {
                  endpoint: '1.2.3.4:51820',
                  publicKey: 'pk',
                },
              ],
            },
          },
        ],
      },
    ]);
    expect(wg).toMatchObject({
      protocol: 'wireguard',
      address: '1.2.3.4',
      port: 51820,
      wgSecretKey: 'sk',
      wgAddress: ['10.0.0.2/32'],
      wgPeers: [{ endpoint: '1.2.3.4:51820', publicKey: 'pk' }],
    });
  });
});
