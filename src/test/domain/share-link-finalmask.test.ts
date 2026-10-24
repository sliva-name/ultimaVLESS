import { describe, expect, it } from 'vitest';
import { parseDirectLinksFromText } from '@/main/services/subscription/linkParsing';
import { XrayConfigCompiler } from '@/main/services/XrayConfigCompiler';
import type { VlessConfig } from '@/shared/types';

function parseOne(link: string): VlessConfig {
  const configs = parseDirectLinksFromText(link);
  expect(configs).toHaveLength(1);
  return configs[0]!;
}

function compiledFinalmask(server: VlessConfig): unknown {
  return XrayConfigCompiler.compile(server, {
    logPath: '/tmp/xray.log',
    connectionMode: 'proxy',
  }).outbounds[0].streamSettings?.finalmask;
}

const fm = (value: unknown): string =>
  encodeURIComponent(JSON.stringify(value));

const salamander = (settings: Record<string, unknown>) => ({
  type: 'salamander',
  settings,
});

describe('share link finalmask', () => {
  const serverFinalmask = {
    tcp: [{ type: 'fragment', settings: { packets: 'tlshello' } }],
    udp: [{ type: 'noise', settings: { reset: 0 } }],
    quicParams: { congestion: 'bbr' },
  };

  it('imports the whole finalmask from fm on VLESS, Trojan and Hysteria2', () => {
    const vless = parseOne(
      `vless://user-id@example.com:443?type=xhttp&security=tls&fm=${fm(serverFinalmask)}#V`,
    );
    const trojan = parseOne(
      `trojan://pass@tj.example.com:443?security=tls&fm=${fm(serverFinalmask)}#T`,
    );
    const hy2 = parseOne(
      `hy2://auth@hy.example.com:443?sni=hy.example.com&fm=${fm(serverFinalmask)}#H`,
    );
    const ss = parseOne(
      `ss://YWVzLTI1Ni1nY206cGFzcw@ss.example.com:8388?fm=${fm(serverFinalmask)}#S`,
    );

    for (const server of [vless, trojan, hy2, ss]) {
      expect(server.finalmask).toEqual(serverFinalmask);
      expect(compiledFinalmask(server)).toEqual(serverFinalmask);
    }
  });

  it('ignores a broken fm without dropping the link', () => {
    const server = parseOne(
      'vless://user-id@example.com:443?security=tls&fm=%7Bbroken#V',
    );
    expect(server.name).toBe('V');
    expect(server.finalmask).toBeUndefined();

    const array = parseOne(
      `trojan://pass@tj.example.com:443?fm=${fm([1, 2])}#T`,
    );
    expect(array.finalmask).toBeUndefined();
  });

  it('turns a legacy udpHop in fm into a trailing udphop mask', () => {
    const server = parseOne(
      `hy2://auth@hy.example.com:443?mport=40000-41000&fm=${fm({
        udp: [salamander({ password: 'p' })],
        quicParams: { udpHop: { ports: '20000-30000', interval: 10 } },
      })}#H`,
    );

    // The server's own hop wins over mport.
    expect(server.finalmask).toEqual({
      udp: [
        salamander({ password: 'p' }),
        {
          type: 'udphop',
          settings: {
            mode: 'intervalLocal,intervalRemote',
            remotePorts: '20000-30000',
            interval: 10,
          },
        },
      ],
    });
  });

  it('parses Hysteria2 links with several ports into a udphop mask', () => {
    const server = parseOne(
      'hysteria2://auth@hy.example.com:443,20000-30000/?sni=hy.example.com&obfs=salamander&obfs-password=obfs-pass#Hop',
    );

    expect(server).toMatchObject({
      address: 'hy.example.com',
      port: 443,
      name: 'Hop',
      sni: 'hy.example.com',
      hysteriaAuth: 'auth',
    });
    expect(server.finalmask).toEqual({
      udp: [
        {
          type: 'udphop',
          settings: {
            mode: 'intervalLocal,intervalRemote',
            remotePorts: '443,20000-30000',
          },
        },
      ],
    });
    // Salamander goes on the socket side, but the dialing mask stays last.
    expect(compiledFinalmask(server)).toEqual({
      udp: [
        salamander({ password: 'obfs-pass' }),
        {
          type: 'udphop',
          settings: {
            mode: 'intervalLocal,intervalRemote',
            remotePorts: '443,20000-30000',
          },
        },
      ],
    });
  });

  it('takes the first port of a port range or an IPv6 host', () => {
    expect(
      parseOne('hy2://auth@hy.example.com:20000-30000?sni=x#Range'),
    ).toMatchObject({ port: 20000 });

    const ipv6 = parseOne('hy2://auth@[2001:db8::1]:8443,5000-6000/#V6');
    expect(ipv6).toMatchObject({ address: '2001:db8::1', port: 8443 });
    expect(ipv6.finalmask?.udp).toEqual([
      {
        type: 'udphop',
        settings: {
          mode: 'intervalLocal,intervalRemote',
          remotePorts: '8443,5000-6000',
        },
      },
    ]);
  });

  it('still drops a Hysteria2 link with a malformed port list', () => {
    expect(
      parseDirectLinksFromText('hy2://auth@hy.example.com:443,70000-80000#Bad'),
    ).toEqual([]);
    expect(
      parseDirectLinksFromText('hy2://auth@hy.example.com:443,abc#Bad'),
    ).toEqual([]);
  });

  it('maps mport to an intervalremote udphop mask', () => {
    const server = parseOne(
      'hy2://auth@hy.example.com:443?mport=20000-30000,40000&sni=x#M',
    );
    expect(server.port).toBe(443);
    expect(server.finalmask).toEqual({
      udp: [
        {
          type: 'udphop',
          settings: {
            mode: 'intervalremote',
            interval: '5-10',
            remotePorts: '20000-30000,40000',
          },
        },
      ],
    });

    expect(
      parseOne('hy2://auth@hy.example.com:443?mport=bad#M').finalmask,
    ).toBeUndefined();
  });

  it('keeps a udphop or xicmp mask from fm over mport', () => {
    const fmHop = {
      udp: [
        {
          type: 'udphop',
          settings: { mode: 'perConnRemote', remotePorts: '1000-2000' },
        },
      ],
    };
    expect(
      parseOne(
        `hy2://auth@hy.example.com:443?mport=20000-30000&fm=${fm(fmHop)}#M`,
      ).finalmask,
    ).toEqual(fmHop);

    const fmXicmp = { udp: [{ type: 'xicmp', settings: {} }] };
    expect(
      parseOne(`hy2://auth@hy.example.com:443,20000-30000/?fm=${fm(fmXicmp)}#M`)
        .finalmask,
    ).toEqual(fmXicmp);
  });

  it('maps gecko obfs to salamander with packetSize', () => {
    const server = parseOne(
      'hy2://auth@hy.example.com:443?obfs=gecko&obfs-password=obfs-pass&minPacketSize=512&maxPacketSize=1200#G',
    );
    expect(server.hysteriaObfs).toEqual({
      type: 'gecko',
      password: 'obfs-pass',
      packetSize: '512-1200',
    });
    expect(compiledFinalmask(server)).toEqual({
      udp: [salamander({ password: 'obfs-pass', packetSize: '512-1200' })],
    });

    // Sizes outside Xray's 1..2048 leave plain salamander.
    const invalid = parseOne(
      'hy2://auth@hy.example.com:443?obfs=gecko&obfs-password=obfs-pass&minPacketSize=512&maxPacketSize=4096#G',
    );
    expect(compiledFinalmask(invalid)).toEqual({
      udp: [salamander({ password: 'obfs-pass' })],
    });
  });

  it('lets a salamander mask from fm win over the obfs params', () => {
    const fmSalamander = {
      udp: [salamander({ password: 'fm-pass', packetSize: '100-200' })],
    };
    const server = parseOne(
      `hy2://auth@hy.example.com:443?obfs=gecko&obfs-password=link-pass&minPacketSize=1&maxPacketSize=2&mport=20000-30000&fm=${fm(fmSalamander)}#F`,
    );

    expect(compiledFinalmask(server)).toEqual({
      udp: [
        salamander({ password: 'fm-pass', packetSize: '100-200' }),
        {
          type: 'udphop',
          settings: {
            mode: 'intervalremote',
            interval: '5-10',
            remotePorts: '20000-30000',
          },
        },
      ],
    });
  });

  it('puts link masks between fm masks and the dialing mask', () => {
    const server = parseOne(
      `hy2://auth@hy.example.com:443,20000-30000?obfs=gecko&obfs-password=obfs-pass&minPacketSize=512&maxPacketSize=1200&fm=${fm(
        {
          udp: [{ type: 'noise', settings: {} }],
        },
      )}#O`,
    );

    expect(compiledFinalmask(server)).toEqual({
      udp: [
        { type: 'noise', settings: {} },
        salamander({ password: 'obfs-pass', packetSize: '512-1200' }),
        {
          type: 'udphop',
          settings: {
            mode: 'intervalLocal,intervalRemote',
            remotePorts: '443,20000-30000',
          },
        },
      ],
    });
  });

  it('maps mKCP headerType and seed to mkcp-legacy masks', () => {
    const server = parseOne(
      'vless://user-id@example.com:443?type=kcp&security=tls&sni=example.com&headerType=wechat-video&seed=kcp-seed#K',
    );
    const masks = {
      udp: [
        { type: 'mkcp-legacy', settings: { header: '', value: 'kcp-seed' } },
        { type: 'mkcp-legacy', settings: { header: 'wechat', value: '' } },
      ],
    };
    expect(server.finalmask).toEqual(masks);
    expect(compiledFinalmask(server)).toEqual(masks);

    expect(
      parseOne('vless://user-id@example.com:443?type=mkcp&headerType=dtls#K')
        .finalmask,
    ).toEqual({
      udp: [{ type: 'mkcp-legacy', settings: { header: 'dtls', value: '' } }],
    });
  });

  it('adds no mkcp-legacy masks without obfuscation or outside mKCP', () => {
    for (const link of [
      'vless://user-id@example.com:443?type=kcp&headerType=none#K',
      // Xray would reject an unknown header outright.
      'vless://user-id@example.com:443?type=kcp&headerType=unknown&seed=s#K',
      'vless://user-id@example.com:443?type=tcp&headerType=http&seed=s#T',
    ]) {
      expect(parseOne(link).finalmask).toBeUndefined();
    }
  });

  it('keeps mkcp-legacy masks from fm over headerType and seed', () => {
    const fmKcp = {
      udp: [{ type: 'mkcp-legacy', settings: { header: 'srtp', value: '' } }],
    };
    expect(
      parseOne(
        `vless://user-id@example.com:443?type=kcp&headerType=dtls&seed=s&fm=${fm(fmKcp)}#K`,
      ).finalmask,
    ).toEqual(fmKcp);
  });

  it('keeps server ids of links without the new params', () => {
    const ids: Array<[string, string]> = [
      [
        'vless://user-id@example.com:443?type=kcp&security=none#Kcp',
        'user-id-example.com:443-7e5951dcc0e9e21b',
      ],
      [
        'vless://user-id@example.com:443?type=xhttp&security=reality&sni=example.com&pbk=key&sid=ab&fp=chrome&path=%2Fx#Vx',
        'user-id-example.com:443-a837c8ddf55e457a',
      ],
      [
        'trojan://pass@tj.example.com:443?type=ws&security=tls&sni=tj.example.com&path=%2Fws#Tj',
        'tj5339c1-tj.example.com:443-6858b06cc169c3c1',
      ],
      [
        'hy2://secret@hy.example.com:443?sni=hy.example.com&obfs=salamander&obfs-password=pass#Hy',
        'hy242d82-hy.example.com:443-e07c86ba0f9d5f00',
      ],
      [
        'hysteria2://secret@hy.example.com?sni=hy.example.com#HyNoPort',
        'hy242d82-hy.example.com:443-9d42a964acb2fcad',
      ],
      [
        'ss://YWVzLTI1Ni1nY206cGFzcw@ss.example.com:8388#SS',
        'ss372725-ss.example.com:8388-d074ba46cbf2fa44',
      ],
    ];

    for (const [link, id] of ids) {
      expect(parseOne(link).uuid).toBe(id);
    }
  });

  it('keeps the id of a server when its link gains masks', () => {
    const pairs: Array<[string, string]> = [
      [
        'vless://user-id@example.com:443?type=kcp&security=none#Kcp',
        `vless://user-id@example.com:443?type=kcp&security=none&headerType=dtls&seed=s&fm=${fm({ tcp: [] })}#Kcp`,
      ],
      [
        'hy2://secret@hy.example.com:443?sni=hy.example.com&obfs=salamander&obfs-password=pass#Hy',
        'hy2://secret@hy.example.com:443,20000-30000?sni=hy.example.com&obfs=salamander&obfs-password=pass&mport=1000-2000#Hy',
      ],
    ];

    for (const [before, after] of pairs) {
      expect(parseOne(after).uuid).toBe(parseOne(before).uuid);
    }
  });
});
