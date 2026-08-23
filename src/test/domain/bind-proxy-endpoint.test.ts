import { describe, expect, it } from 'vitest';
import { makeServer } from '@/test/factories';
import type { XrayConfig } from '@/shared/xray-types';
import { bindProxyEndpointToIp } from '@/main/domain/connection/bindProxyEndpoint';

describe('bindProxyEndpointToIp', () => {
  it('rewrites structured address and leaves SNI alone', () => {
    const server = makeServer({
      address: 'oauth.example.com',
      sni: 'oauth.example.com',
      security: 'reality',
    });
    const bound = bindProxyEndpointToIp(server, '203.0.113.10');
    expect(bound.address).toBe('203.0.113.10');
    expect(bound.sni).toBe('oauth.example.com');
  });

  it('rewrites raw vnext address but keeps REALITY serverName', () => {
    const server = makeServer({
      address: 'oauth.example.com',
      security: 'reality',
      pbk: 'public-key',
      rawConfig: {
        outbounds: [
          {
            tag: 'proxy',
            protocol: 'vless',
            settings: {
              vnext: [
                {
                  address: 'oauth.example.com',
                  port: 443,
                  users: [
                    {
                      id: '00000000-0000-0000-0000-000000000001',
                      encryption: 'none',
                      flow: 'xtls-rprx-vision',
                    },
                  ],
                },
              ],
            },
            streamSettings: {
              network: 'tcp',
              security: 'reality',
              realitySettings: {
                serverName: 'oauth.example.com',
                publicKey: 'public-key',
              },
            },
          },
        ],
      } as XrayConfig,
    });

    const bound = bindProxyEndpointToIp(server, '198.51.100.7');
    const proxy = bound.rawConfig?.outbounds?.[0] as {
      settings: { vnext: Array<{ address: string }> };
      streamSettings: { realitySettings: { serverName: string } };
    };
    expect(bound.address).toBe('198.51.100.7');
    expect(proxy.settings.vnext[0].address).toBe('198.51.100.7');
    expect(proxy.streamSettings.realitySettings.serverName).toBe(
      'oauth.example.com',
    );
  });
});
