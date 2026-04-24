import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encode } from 'js-base64';
import { SubscriptionService } from './SubscriptionService';

function createTextResponse(
  body: string,
  options: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}
): Response {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: {
      get: (name: string) => options.headers?.[name.toLowerCase()] ?? options.headers?.[name] ?? null,
    },
    text: async () => body,
  } as Response;
}

function mockFetchText(
  body: string,
  options: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}
): void {
  vi.mocked(globalThis.fetch).mockResolvedValue(createTextResponse(body, options));
}

describe('SubscriptionService', () => {
  const service = new SubscriptionService();
  const mockVlessLink =
    'vless://uuid@example.com:443?type=tcp&security=reality&sni=example.com&fp=chrome&pbk=key&sid=123#TestServer';

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('fetchAndParse', () => {
    it('parses a base64 subscription response into VLESS configs', async () => {
      mockFetchText(encode(`${mockVlessLink}\n`));

      const configs = await service.fetchAndParse('https://sub.url');

      expect(configs).toHaveLength(1);
      expect(configs[0]).toMatchObject({
        name: 'TestServer',
        address: 'example.com',
        security: 'reality',
      });
    });

    it('parses multiple protocol links from one encoded response', async () => {
      const link2 = 'vless://uuid2@test.com:443?type=ws&security=tls#Server2';
      mockFetchText(encode([mockVlessLink, link2].join('\n')));

      const configs = await service.fetchAndParse('https://sub.url');

      expect(configs.map((config) => config.name)).toEqual(['TestServer', 'Server2']);
      expect(configs[1].type).toBe('ws');
    });

    it('parses direct links from plain-text and HTML responses', async () => {
      const scenarios = [
        {
          url: 'https://translated.turbopages.org/some/path',
          body: [
            'translated page',
            'vless://uuid@example.com:443?type=tcp&security=reality&sni=example.com&fp=chrome&pbk=key&sid=123#One',
            // hysteria2 is intentionally not supported by linkParsing.ts; this
            // line exists to confirm it is silently filtered out (see
            // expectedNames below — only 'One' should survive).
            'hysteria2://pass@144.31.224.14:443/?insecure=1&amp;sni=www.cloudflare.com#Two',
          ].join('\n'),
          expectedNames: ['One'],
        },
        {
          url: 'https://translated.turbopages.org/attributes',
          body: [
            '<div>',
            '<a href="vless://uuid@example.com:443?type=tcp&amp;security=reality&amp;sni=example.com#AttrOne">one</a>',
            '</div>',
          ].join('\n'),
          expectedNames: ['AttrOne'],
        },
      ];

      for (const scenario of scenarios) {
        mockFetchText(scenario.body);
        const configs = await service.fetchAndParse(scenario.url);
        expect(configs.map((config) => config.name)).toEqual(scenario.expectedNames);
        vi.mocked(globalThis.fetch).mockReset();
      }
    });

    it('uses browser-like headers when fetching translate.yandex.ru HTML', async () => {
      mockFetchText(`<!DOCTYPE html><html><body>${mockVlessLink}</body></html>`);

      await service.fetchAndParse(
        'https://translate.yandex.ru/translate?url=https://raw.githubusercontent.com/x/y.txt&lang=de-de'
      );

      const init = vi.mocked(globalThis.fetch).mock.calls.at(-1)?.[1] as RequestInit | undefined;
      expect(init?.headers).toMatchObject({
        'User-Agent': expect.stringContaining('Chrome'),
      });
    });

    it('rejects invalid response bodies and unsafe URLs', async () => {
      mockFetchText('invalid-base-64%%');
      await expect(service.fetchAndParse('https://sub.url')).rejects.toThrow('Invalid Base64 response');
      await expect(service.fetchAndParse('file:///etc/passwd')).rejects.toThrow(/Only HTTP\(S\)/);
      await expect(service.fetchAndParse('http://127.0.0.1/sub')).rejects.toThrow(/host is not allowed/);
    });

    it('rejects redirects to private hosts', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        createTextResponse('', {
          ok: false,
          status: 302,
          headers: { location: 'http://127.0.0.1/private' },
        })
      );

      await expect(service.fetchAndParse('https://safe.example/sub')).rejects.toThrow(/host is not allowed/);
    });
  });

  describe('parseDirectLinksFromText', () => {
    it.each([
      {
        input: 'hysteria2://pass@144.31.224.14:443/?insecure=1&amp;sni=www.cloudflare.com#NL',
        expectedLength: 0,
      },
      {
        input: 'vless://uuid@example.com:443#NoQueryName',
        expectedLength: 1,
      },
      {
        input: 'vless://uuid@example.com:99999?type=tcp#BadPort',
        expectedLength: 0,
      },
    ])('returns $expectedLength configs for $input', ({ input, expectedLength }) => {
      expect(service.parseDirectLinksFromText(input)).toHaveLength(expectedLength);
    });

    it('keeps the fragment as the config name when a VLESS link has no query params', () => {
      const [config] = service.parseDirectLinksFromText('vless://uuid@example.com:443#NoQueryName');

      expect(config.name).toBe('NoQueryName');
      expect(config.port).toBe(443);
    });

    it('creates unique internal ids for links that differ by routing fields', () => {
      const byShortId = service.parseDirectLinksFromText(
        [
          'vless://same-user-id@example.com:443?type=tcp&security=reality&sni=one.example&sid=111#A',
          'vless://same-user-id@example.com:443?type=tcp&security=reality&sni=two.example&sid=222#B',
        ].join('\n')
      );
      const byFingerprint = service.parseDirectLinksFromText(
        [
          'vless://same-user-id@example.com:443?type=tcp&security=reality&sni=one.example&fp=chrome#A',
          'vless://same-user-id@example.com:443?type=tcp&security=reality&sni=one.example&fp=qq#B',
        ].join('\n')
      );

      expect(byShortId).toHaveLength(2);
      expect(byShortId[0].uuid).not.toBe(byShortId[1].uuid);
      expect(byShortId[0].userId).toBe('same-user-id');
      expect(byShortId[1].userId).toBe('same-user-id');
      expect(byFingerprint[0].uuid).not.toBe(byFingerprint[1].uuid);
    });
  });
});

