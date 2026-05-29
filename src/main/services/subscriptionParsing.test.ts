import { describe, expect, it } from 'vitest';
import { parseDirectLinksFromText } from './subscription/linkParsing';
import { parseJsonConfigs } from './subscription/jsonParsing';

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
});
