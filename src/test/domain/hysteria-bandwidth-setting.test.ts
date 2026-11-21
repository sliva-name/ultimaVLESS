import { describe, expect, it } from 'vitest';
import { buildServerDetails } from '@/main/services/serverDetails';
import { parseDirectLinksFromText } from '@/main/services/subscription/linkParsing';
import { XrayConfigCompiler } from '@/main/services/XrayConfigCompiler';
import {
  isUnmodifiedLegacyPerformanceSettings,
  LEGACY_PERFORMANCE_CORE,
  normalizePerformanceSettings,
  performanceSettingsEqual,
} from '@/shared/performanceSettings';
import { readMbpsInput } from '@/shared/hysteriaBandwidth';
import {
  DEFAULT_PERFORMANCE_SETTINGS,
  type PerformanceSettings,
  type VlessConfig,
} from '@/shared/types';
import type { XrayConfig } from '@/shared/xray-types';
import { makeServer } from '@/test/factories';

const HY2 = 'hy2://auth@hy.example.com:443?sni=hy.example.com';

function parseOne(link: string): VlessConfig {
  const configs = parseDirectLinksFromText(link);
  expect(configs).toHaveLength(1);
  return configs[0]!;
}

function device(up: number, down: number): PerformanceSettings {
  return {
    ...DEFAULT_PERFORMANCE_SETTINGS,
    hysteriaUpMbps: up,
    hysteriaDownMbps: down,
  };
}

function compile(
  server: VlessConfig,
  performanceSettings?: PerformanceSettings,
  connectionMode: 'proxy' | 'tun' = 'proxy',
): XrayConfig {
  return XrayConfigCompiler.compile(server, {
    logPath: '/tmp/xray.log',
    connectionMode,
    performanceSettings,
  });
}

const finalmaskOf = (
  server: VlessConfig,
  performanceSettings?: PerformanceSettings,
): unknown =>
  compile(server, performanceSettings).outbounds[0].streamSettings?.finalmask;

const fm = (value: unknown): string =>
  encodeURIComponent(JSON.stringify(value));

/** A Hysteria2 server from a JSON subscription. */
function rawHysteria(finalmask?: unknown): VlessConfig {
  return makeServer({
    uuid: 'hy-json',
    protocol: 'hysteria',
    address: 'hy.example.com',
    rawConfig: {
      outbounds: [
        {
          tag: 'proxy',
          protocol: 'hysteria',
          settings: { version: 2, address: 'hy.example.com', port: 443 },
          streamSettings: {
            network: 'hysteria',
            security: 'tls',
            hysteriaSettings: { version: 2, auth: 'token' },
            tlsSettings: { serverName: 'hy.example.com' },
            ...(finalmask === undefined ? {} : { finalmask }),
          },
        },
      ],
    } as unknown as XrayConfig,
  });
}

describe('Hysteria2 speed setting: storage', () => {
  it('is not set by default and in settings saved before it existed', () => {
    expect(DEFAULT_PERFORMANCE_SETTINGS.hysteriaUpMbps).toBe(0);
    expect(DEFAULT_PERFORMANCE_SETTINGS.hysteriaDownMbps).toBe(0);

    const { hysteriaUpMbps, hysteriaDownMbps, ...older } =
      DEFAULT_PERFORMANCE_SETTINGS;
    expect([hysteriaUpMbps, hysteriaDownMbps]).toEqual([0, 0]);
    expect(normalizePerformanceSettings(older)).toEqual(
      DEFAULT_PERFORMANCE_SETTINGS,
    );
  });

  it('keeps a rate Xray accepts', () => {
    for (const mbps of [0.5, 12.5, 100, 1024 * 1024]) {
      const settings = normalizePerformanceSettings(device(mbps, mbps));
      expect(settings.hysteriaUpMbps).toBe(mbps);
      expect(settings.hysteriaDownMbps).toBe(mbps);
    }
  });

  it('drops anything else to "not set"', () => {
    for (const value of [
      0.4,
      -5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1024 * 1024 + 1,
      '100',
      null,
      true,
    ]) {
      const settings = normalizePerformanceSettings({
        ...DEFAULT_PERFORMANCE_SETTINGS,
        hysteriaUpMbps: value,
        hysteriaDownMbps: value,
      });
      expect(settings.hysteriaUpMbps).toBe(0);
      expect(settings.hysteriaDownMbps).toBe(0);
    }
  });

  it('counts as a change and blocks the legacy-defaults migration', () => {
    expect(
      performanceSettingsEqual(device(0, 100), DEFAULT_PERFORMANCE_SETTINGS),
    ).toBe(false);
    expect(
      performanceSettingsEqual(device(0, 0), DEFAULT_PERFORMANCE_SETTINGS),
    ).toBe(true);

    expect(isUnmodifiedLegacyPerformanceSettings(LEGACY_PERFORMANCE_CORE)).toBe(
      true,
    );
    expect(
      isUnmodifiedLegacyPerformanceSettings({
        ...LEGACY_PERFORMANCE_CORE,
        hysteriaUpMbps: 0,
        hysteriaDownMbps: 0,
      }),
    ).toBe(true);
    expect(
      isUnmodifiedLegacyPerformanceSettings({
        ...LEGACY_PERFORMANCE_CORE,
        hysteriaDownMbps: 100,
      }),
    ).toBe(false);
  });

  it('reads a typed speed: empty is "not set", the rest is clamped', () => {
    expect(readMbpsInput('')).toBe(0);
    expect(readMbpsInput('  ')).toBe(0);
    expect(readMbpsInput('0')).toBe(0);
    expect(readMbpsInput('100')).toBe(100);
    expect(readMbpsInput('12.5')).toBe(12.5);
    expect(readMbpsInput('0,5')).toBe(0.5);
    expect(readMbpsInput('0.1')).toBe(0.5);
    expect(readMbpsInput('5000000')).toBe(1024 * 1024);
    expect(readMbpsInput('1.2.3')).toBeNull();
    expect(readMbpsInput('.')).toBeNull();
  });
});

describe('Hysteria2 speed setting: config', () => {
  it('declares the setting for a link without a speed, in proxy and TUN', () => {
    const server = parseOne(`${HY2}#H`);
    for (const mode of ['proxy', 'tun'] as const) {
      expect(
        compile(server, device(40, 200), mode).outbounds[0].streamSettings
          ?.finalmask,
      ).toEqual({
        quicParams: { brutalUp: '40 mbps', brutalDown: '200 mbps' },
      });
    }
    expect(server.finalmask).toBeUndefined();
  });

  it("lets the link's upmbps/downmbps win, direction by direction", () => {
    expect(
      finalmaskOf(parseOne(`${HY2}&upmbps=10&downmbps=50#H`), device(40, 200)),
    ).toEqual({ quicParams: { brutalUp: '10 mbps', brutalDown: '50 mbps' } });

    expect(
      finalmaskOf(parseOne(`${HY2}&downmbps=50#H`), device(40, 200)),
    ).toEqual({ quicParams: { brutalUp: '40 mbps', brutalDown: '50 mbps' } });

    // Only one direction set on the device: the other stays undeclared.
    expect(finalmaskOf(parseOne(`${HY2}#H`), device(0, 200))).toEqual({
      quicParams: { brutalDown: '200 mbps' },
    });
  });

  it("lets the link's own fm win over both, other quicParams kept", () => {
    const own = { congestion: 'bbr', brutalUp: '20 mbps' };
    const server = parseOne(
      `${HY2}&downmbps=50&fm=${fm({ quicParams: own })}#H`,
    );
    expect(finalmaskOf(server, device(40, 200))).toEqual({
      quicParams: { ...own, brutalDown: '50 mbps' },
    });

    // fm's own "0" declares no rate, and the setting does not replace it.
    const none = { quicParams: { brutalUp: '0', brutalDown: '0' } };
    expect(
      finalmaskOf(parseOne(`${HY2}&fm=${fm(none)}#H`), device(40, 200)),
    ).toEqual(none);
  });

  it('keeps salamander and port hopping', () => {
    const server = parseOne(
      'hy2://auth@hy.example.com:443,20000-30000/?obfs=salamander&obfs-password=pw#H',
    );
    expect(finalmaskOf(server, device(40, 200))).toEqual({
      udp: [
        { type: 'salamander', settings: { password: 'pw' } },
        {
          type: 'udphop',
          settings: {
            mode: 'intervalLocal,intervalRemote',
            remotePorts: '443,20000-30000',
          },
        },
      ],
      quicParams: { brutalUp: '40 mbps', brutalDown: '200 mbps' },
    });
  });

  it('declares nothing for other protocols or a rate Xray refuses', () => {
    const vless = parseOne(
      'vless://11111111-1111-1111-1111-111111111111@v.example.com:443?type=xhttp&security=tls&sni=v.example.com#V',
    );
    expect(finalmaskOf(vless, device(40, 200))).toBeUndefined();

    // Settings that skipped normalization (an old or edited store).
    const hy = parseOne(`${HY2}#H`);
    expect(finalmaskOf(hy, device(0.1, Number.NaN))).toBeUndefined();
    expect(finalmaskOf(hy, device(-1, 2e6))).toBeUndefined();
  });

  it('fills in a JSON Hysteria2 server, its own quicParams first', () => {
    const plain = compile(rawHysteria(), device(40, 200));
    expect(plain.outbounds[0].streamSettings?.finalmask).toEqual({
      quicParams: { brutalUp: '40 mbps', brutalDown: '200 mbps' },
    });

    const own = {
      udp: [{ type: 'salamander', settings: { password: 'obfs' } }],
      quicParams: { congestion: 'brutal', brutalDown: '30 mbps' },
    };
    const server = rawHysteria(own);
    expect(
      compile(server, device(40, 200)).outbounds[0].streamSettings?.finalmask,
    ).toEqual({
      udp: own.udp,
      quicParams: { ...own.quicParams, brutalUp: '40 mbps' },
    });
    // The stored config stays the provider's.
    expect(
      (server.rawConfig?.outbounds[0].streamSettings as { finalmask: unknown })
        .finalmask,
    ).toEqual(own);

    // A malformed finalmask is Xray's to report, not ours to replace.
    expect(
      compile(rawHysteria('broken'), device(40, 200)).outbounds[0]
        .streamSettings?.finalmask,
    ).toBe('broken');
  });
});

describe('Hysteria2 speed setting: unset', () => {
  const servers: [string, VlessConfig][] = [
    ['plain link', parseOne(`${HY2}#H`)],
    ['link speed', parseOne(`${HY2}&upmbps=40&downmbps=200#H`)],
    [
      'fm and salamander',
      parseOne(
        `hy2://auth@hy.example.com:443,20000-30000/?obfs=salamander&obfs-password=pw&fm=${fm({ quicParams: { congestion: 'bbr' } })}#H`,
      ),
    ],
    ['JSON', rawHysteria()],
    ['JSON with quicParams', rawHysteria({ quicParams: { brutalUp: '5m' } })],
    [
      'VLESS',
      parseOne(
        'vless://11111111-1111-1111-1111-111111111111@v.example.com:443?type=tcp&security=reality&pbk=k&sid=ab&sni=v.example.com#V',
      ),
    ],
  ];

  it('leaves every config byte-identical', () => {
    for (const [, server] of servers) {
      for (const mode of ['proxy', 'tun'] as const) {
        const before = JSON.stringify(compile(server, undefined, mode));
        for (const unset of [
          DEFAULT_PERFORMANCE_SETTINGS,
          device(0, 0),
          normalizePerformanceSettings({ hysteriaUpMbps: '', down: 5 }),
        ]) {
          expect(JSON.stringify(compile(server, unset, mode))).toBe(before);
        }
      }
    }
  });

  it('adds no finalmask to a Hysteria2 link that had none', () => {
    expect(finalmaskOf(parseOne(`${HY2}#H`))).toBeUndefined();
    expect(
      compile(rawHysteria()).outbounds[0].streamSettings,
    ).not.toHaveProperty('finalmask');
  });
});

describe('Hysteria2 speed setting: server details', () => {
  const fields = (server: VlessConfig, settings?: PerformanceSettings) =>
    buildServerDetails(server, settings).fields.filter((field) =>
      field.key.startsWith('bandwidth'),
    );

  it("shows the device's speed, marked as the device's", () => {
    expect(fields(parseOne(`${HY2}#H`), device(40, 200))).toEqual([
      { key: 'bandwidthUp', value: '40 mbps', fromDevice: true },
      { key: 'bandwidthDown', value: '200 mbps', fromDevice: true },
    ]);
  });

  it("shows the link's own speed unmarked where it wins", () => {
    expect(fields(parseOne(`${HY2}&downmbps=50#H`), device(40, 200))).toEqual([
      { key: 'bandwidthUp', value: '40 mbps', fromDevice: true },
      { key: 'bandwidthDown', value: '50 mbps' },
    ]);

    const own = { quicParams: { brutalUp: '20 mbps', brutalDown: '0' } };
    expect(fields(parseOne(`${HY2}&fm=${fm(own)}#H`), device(40, 200))).toEqual(
      [{ key: 'bandwidthUp', value: '20 mbps' }],
    );
  });

  it('shows nothing new while the setting is not set', () => {
    const server = parseOne(`${HY2}&upmbps=40#H`);
    expect(buildServerDetails(server, DEFAULT_PERFORMANCE_SETTINGS)).toEqual(
      buildServerDetails(server),
    );
    expect(fields(parseOne(`${HY2}#H`), DEFAULT_PERFORMANCE_SETTINGS)).toEqual(
      [],
    );
    // Not a Hysteria2 server: no speed at all.
    expect(
      fields(
        parseOne(
          'vless://11111111-1111-1111-1111-111111111111@v.example.com:443?security=tls#V',
        ),
        device(40, 200),
      ),
    ).toEqual([]);
  });
});
