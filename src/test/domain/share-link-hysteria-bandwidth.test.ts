import { describe, expect, it } from 'vitest';
import { buildServerDetails } from '@/main/services/serverDetails';
import { parseDirectLinksFromText } from '@/main/services/subscription/linkParsing';
import { XrayConfigCompiler } from '@/main/services/XrayConfigCompiler';
import type { VlessConfig } from '@/shared/types';

const HY2 = 'hy2://auth@hy.example.com:443?sni=hy.example.com';

function parseOne(link: string): VlessConfig {
  const configs = parseDirectLinksFromText(link);
  expect(configs).toHaveLength(1);
  return configs[0]!;
}

function compiledFinalmask(
  server: VlessConfig,
  connectionMode: 'proxy' | 'tun' = 'proxy',
): unknown {
  return XrayConfigCompiler.compile(server, {
    logPath: '/tmp/xray.log',
    connectionMode,
  }).outbounds[0].streamSettings?.finalmask;
}

const fm = (value: unknown): string =>
  encodeURIComponent(JSON.stringify(value));

const hop = {
  type: 'udphop',
  settings: {
    mode: 'intervalLocal,intervalRemote',
    remotePorts: '443,20000-30000',
  },
};

describe('Hysteria2 link speed (Brutal)', () => {
  it('reads upmbps/downmbps in Mbit/s', () => {
    const server = parseOne(`${HY2}&upmbps=40&downmbps=200#H`);
    expect(server.hysteriaUpMbps).toBe(40);
    expect(server.hysteriaDownMbps).toBe(200);
  });

  it("reads mihomo's up/down with Xray units, upmbps/downmbps first", () => {
    const mihomo = parseOne(`${HY2}&up=30%20Mbps&down=1g#H`);
    expect(mihomo.hysteriaUpMbps).toBe(30);
    expect(mihomo.hysteriaDownMbps).toBe(1024);

    const both = parseOne(`${HY2}&up=10&upmbps=20&down=&downmbps=512kbps#H`);
    expect(both.hysteriaUpMbps).toBe(20);
    expect(both.hysteriaDownMbps).toBe(0.5);
  });

  it('ignores a speed that declares nothing or that Xray would refuse', () => {
    // 0 is "not declared"; under 0.5 mbps (65536 B/s) Xray refuses the config.
    for (const value of [
      '0',
      '0.4',
      '-5',
      'fast',
      '100 MB/s',
      '1e3',
      '2000000',
      '',
    ]) {
      const speed = encodeURIComponent(value);
      const server = parseOne(`${HY2}&upmbps=${speed}&downmbps=${speed}#H`);
      expect(server).not.toHaveProperty('hysteriaUpMbps');
      expect(server).not.toHaveProperty('hysteriaDownMbps');
      expect(compiledFinalmask(server)).toBeUndefined();
    }
  });

  it('keeps the server id when only the speed changes', () => {
    const before = parseOne(`${HY2}#H`);
    const after = parseOne(`${HY2}&upmbps=40&downmbps=200#H`);
    expect(after.uuid).toBe(before.uuid);
  });

  it('declares the speed in finalmask.quicParams in proxy and TUN mode', () => {
    const server = parseOne(`${HY2}&upmbps=40&downmbps=200#H`);
    for (const mode of ['proxy', 'tun'] as const) {
      expect(compiledFinalmask(server, mode)).toEqual({
        quicParams: { brutalUp: '40 mbps', brutalDown: '200 mbps' },
      });
    }
    // Only in the compiled config: the stored server stays a parsed link.
    expect(server.finalmask).toBeUndefined();
  });

  it('declares only the direction the link gives', () => {
    expect(compiledFinalmask(parseOne(`${HY2}&downmbps=200#H`))).toEqual({
      quicParams: { brutalDown: '200 mbps' },
    });
    expect(compiledFinalmask(parseOne(`${HY2}&upmbps=12.5#H`))).toEqual({
      quicParams: { brutalUp: '12.5 mbps' },
    });
  });

  it("keeps salamander, port hopping and the link's own quicParams", () => {
    const own = { congestion: 'bbr', brutalUp: '20 mbps' };
    const server = parseOne(
      `hy2://auth@hy.example.com:443,20000-30000/?obfs=salamander&obfs-password=pw&upmbps=40&downmbps=200&fm=${fm({ quicParams: own })}#H`,
    );

    // A rate from fm wins; the missing one comes from the link.
    expect(compiledFinalmask(server)).toEqual({
      udp: [{ type: 'salamander', settings: { password: 'pw' } }, hop],
      quicParams: { ...own, brutalDown: '200 mbps' },
    });
    expect(server.finalmask).toEqual({ udp: [hop], quicParams: own });
  });

  it('leaves links without a speed as they were', () => {
    expect(compiledFinalmask(parseOne(`${HY2}#H`))).toBeUndefined();

    const own = { quicParams: { congestion: 'bbr', bbrProfile: 'aggressive' } };
    expect(compiledFinalmask(parseOne(`${HY2}&fm=${fm(own)}#H`))).toEqual(own);
  });

  it('declares nothing for other protocols or a stored speed Xray refuses', () => {
    const vless: VlessConfig = {
      ...parseOne(
        'vless://11111111-1111-1111-1111-111111111111@v.example.com:443?type=xhttp&security=tls&sni=v.example.com#V',
      ),
      hysteriaUpMbps: 40,
      hysteriaDownMbps: 200,
    };
    expect(compiledFinalmask(vless)).toBeUndefined();

    const stored: VlessConfig = {
      ...parseOne(`${HY2}#H`),
      hysteriaUpMbps: 0.1,
      hysteriaDownMbps: Number.NaN,
    };
    expect(compiledFinalmask(stored)).toBeUndefined();
  });

  it('keeps the speed in the share link for copying', () => {
    const server = parseOne(`${HY2}&upmbps=40&downmbps=200#H`);
    expect(server.shareLink).toBe(`${HY2}&upmbps=40&downmbps=200#H`);
    expect(parseOne(server.shareLink!)).toEqual(server);
  });

  it('shows the declared speed in the server details', () => {
    const field = (server: VlessConfig, key: string) =>
      buildServerDetails(server).fields.find((entry) => entry.key === key);

    const server = parseOne(`${HY2}&upmbps=40&downmbps=200#H`);
    expect(field(server, 'bandwidthUp')).toEqual({
      key: 'bandwidthUp',
      value: '40 mbps',
    });
    expect(field(server, 'bandwidthDown')?.value).toBe('200 mbps');

    const own = { quicParams: { brutalUp: '20 mbps', brutalDown: '0' } };
    const withFm = parseOne(`${HY2}&downmbps=200&fm=${fm(own)}#H`);
    expect(field(withFm, 'bandwidthUp')?.value).toBe('20 mbps');
    // fm's own "0" wins and declares no download rate.
    expect(field(withFm, 'bandwidthDown')).toBeUndefined();
    expect(compiledFinalmask(withFm)).toEqual(own);
    expect(withFm.finalmask).toEqual(own);

    expect(field(parseOne(`${HY2}#H`), 'bandwidthUp')).toBeUndefined();
  });
});
