import { describe, expect, it, vi } from 'vitest';
import { parseDirectLinksFromText } from './linkParsing';
import { ConfigGenerator } from '@/main/services/ConfigGenerator';

vi.mock('@/main/services/LoggerService', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const SS_LINK =
  'ss://bm9uZTpodHRwczovL3QubWUvV2FuZ0NhaTLwn4eo8J-Hsw@88.210.53.139:443?plugin=v2ray-plugin%3Bmode%3Dwebsocket%3Bhost%3Dss.lrdxw.club%3Bpath%3D%2F94ce96d3-840d-4320-9b9b-07bdba018212%2F%3Bed%3D2560%3Btls%3Bsni%3Dhttps%3A%2F%2Ft.me%2Foneclickvpnkeys%3Bmux%3D0%3Bskip-cert-verify%3Dtrue#%F0%9F%8C%90%20Anycast-IP';

const TROJAN_LINKS = [
  'trojan://8r%3C%5B9%27l6hAO%238ZQi@151.242.43.77:8443?security=tls&sni=Koma-YT.PAGeS.Dev&type=ws&host=Koma-YT.PAGeS.Dev&path=/trTelegram%F0%9F%87%A8%F0%9F%87%B3%2B%40WangCai2#%F0%9F%87%A9%F0%9F%87%AA%20Germany',
  'trojan://8r%3C%5B9%27l6hAO%238ZQi@213.171.26.104:8443?host=Koma-YT.PAGeS.Dev&path=/trTelegram%F0%9F%87%A8%F0%9F%87%B3+%40WangCai2&security=tls&sni=Koma-YT.PAGeS.Dev&type=ws#%F0%9F%87%AC%F0%9F%87%A7%20United%20Kingdom',
];

describe('parseDirectLinksFromText', () => {
  it('parses Shadowsocks SIP002 link with v2ray-plugin websocket transport', () => {
    const [config] = parseDirectLinksFromText(SS_LINK);
    expect(config).toMatchObject({
      protocol: 'shadowsocks',
      address: '88.210.53.139',
      port: 443,
      method: 'none',
      password: 'https://t.me/WangCai2🇨🇳',
      type: 'ws',
      security: 'tls',
      host: 'ss.lrdxw.club',
      path: '/94ce96d3-840d-4320-9b9b-07bdba018212/',
      sni: 'https://t.me/oneclickvpnkeys',
      allowInsecure: true,
      wsMaxEarlyData: 2560,
      name: '🌐 Anycast-IP',
    });
  });

  it('parses real-world Trojan WebSocket links with special password characters', () => {
    const configs = parseDirectLinksFromText(TROJAN_LINKS.join('\n'));
    expect(configs).toHaveLength(2);
    expect(configs[0]).toMatchObject({
      protocol: 'trojan',
      password: "8r<[9'l6hAO#8ZQi",
      address: '151.242.43.77',
      port: 8443,
      type: 'ws',
      security: 'tls',
      sni: 'Koma-YT.PAGeS.Dev',
      host: 'Koma-YT.PAGeS.Dev',
      path: '/trTelegram🇨🇳+@WangCai2',
    });
    expect(configs[1]?.address).toBe('213.171.26.104');
  });

  it('generates Xray config for Shadowsocks + v2ray-plugin websocket', () => {
    const [config] = parseDirectLinksFromText(SS_LINK);
    expect(config).toBeDefined();

    const xray = ConfigGenerator.generate(config!, '/tmp/log');
    expect(xray.outbounds[0]).toMatchObject({
      protocol: 'shadowsocks',
      settings: {
        address: '88.210.53.139',
        port: 443,
        method: 'none',
        password: 'https://t.me/WangCai2🇨🇳',
      },
      streamSettings: {
        network: 'websocket',
        security: 'tls',
        wsSettings: {
          path: '/94ce96d3-840d-4320-9b9b-07bdba018212/?ed=2560',
          host: 'ss.lrdxw.club',
        },
        tlsSettings: {
          serverName: 'https://t.me/oneclickvpnkeys',
          allowInsecure: true,
        },
      },
    });
  });
});
