import { describe, expect, it } from 'vitest';
import { parseJsonConfigs } from '@/main/services/subscription/jsonParsing';
import { XrayConfigCompiler } from '@/main/services/XrayConfigCompiler';
import type { XrayOutbound } from '@/shared/xray-types';

const UUID = '3c1a510c-3862-4e0f-b007-786b0146fc14';

const vless = (tag: string, address: string, extra: object = {}) => ({
  tag,
  protocol: 'vless',
  settings: {
    vnext: [{ address, port: 443, users: [{ id: UUID, encryption: 'none' }] }],
  },
  streamSettings: {
    network: 'tcp',
    security: 'tls',
    tlsSettings: { serverName: address },
    ...extra,
  },
});

function compile(raw: Record<string, unknown>) {
  const [server] = parseJsonConfigs([raw]);
  expect(server).toBeDefined();
  return {
    server: server!,
    config: XrayConfigCompiler.compile(server!, {
      logPath: '/tmp/xray.log',
      connectionMode: 'proxy',
    }),
  };
}

describe('raw configs whose tunnel outbound is not tagged proxy', () => {
  it('renames the outbound and the rules and dialers that point at it', () => {
    const { config } = compile({
      remarks: 'Tagged',
      outbounds: [
        vless('vless-reality', 'srv.example.org', {
          sockopt: { dialerProxy: 'frag' },
        }),
        { tag: 'frag', protocol: 'freedom', settings: {} },
        vless('chain', 'next.example.org', {
          sockopt: { dialerProxy: 'vless-reality' },
        }),
      ],
      routing: {
        rules: [
          {
            type: 'field',
            domain: ['example.com'],
            outboundTag: 'vless-reality',
          },
        ],
      },
    });

    const tags = config.outbounds.map((outbound) => outbound.tag);
    expect(tags).toContain('proxy');
    expect(tags).not.toContain('vless-reality');
    const chain = config.outbounds.find(
      (o) => o.tag === 'chain',
    ) as XrayOutbound;
    expect(
      (chain.streamSettings as { sockopt: { dialerProxy: string } }).sockopt
        .dialerProxy,
    ).toBe('proxy');
    expect(config.routing.rules).toContainEqual(
      expect.objectContaining({
        domain: ['example.com'],
        outboundTag: 'proxy',
      }),
    );
  });

  it('lists the endpoint of the outbound tagged proxy, not the first one', () => {
    const { server, config } = compile({
      outbounds: [
        vless('proxy-2', 'backup.example.org'),
        vless('proxy', 'main.example.org'),
      ],
    });
    expect(server.address).toBe('main.example.org');
    expect(config.outbounds.filter((o) => o.tag === 'proxy')).toHaveLength(1);
  });

  it('leaves configs that already use the proxy tag unchanged', () => {
    const raw = { outbounds: [vless('proxy', 'srv.example.org')] };
    const [server] = parseJsonConfigs([raw]);
    expect(server?.rawConfig).toEqual(raw);
  });
});
