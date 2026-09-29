import dns from 'dns';
import { encode } from 'js-base64';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubscriptionService } from '@/main/services/SubscriptionService';
import {
  decodeHtmlEntities,
  htmlToText,
  looksLikeHtml,
} from '@/main/services/subscription/htmlResponse';

const VLESS_A =
  'vless://11111111-2222-3333-4444-555555555555@a.example.com:443?type=tcp&security=reality&sni=www.example.com&fp=chrome&pbk=pubkey&sid=ab#Server%20A';
const VLESS_B =
  'vless://66666666-7777-8888-9999-000000000000@b.example.com:8443?type=ws&security=tls&path=%2Fws&host=b.example.com#Server%20B';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function mockResponse(body: string, contentType = 'text/html'): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

describe('htmlResponse helpers', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(
      decodeHtmlEntities(
        'a&amp;b&#61;c&#x3D;d&colon;&#x2F;&sol;&quot;x&nbsp;y',
      ),
    ).toBe('a&b=c=d://"x y');
  });

  it('collapses double-escaped ampersands', () => {
    expect(decodeHtmlEntities('?a=1&amp;amp;b=2')).toBe('?a=1&b=2');
  });

  it('leaves unknown or invalid references untouched', () => {
    expect(decodeHtmlEntities('&bogus; &#0; &#xD800; &amp')).toBe(
      '&bogus; &#0; &#xD800; &amp',
    );
  });

  it('detects HTML documents and fragments', () => {
    expect(looksLikeHtml('<!DOCTYPE html><html></html>')).toBe(true);
    expect(looksLikeHtml('<pre>abc</pre>')).toBe(true);
    expect(looksLikeHtml(VLESS_A)).toBe(false);
    expect(looksLikeHtml(encode(VLESS_A))).toBe(false);
  });

  it('keeps adjacent links apart and joins links split by <wbr>', () => {
    const text = htmlToText(
      `<td>${escapeHtml(VLESS_A)}</td><td>${escapeHtml(VLESS_B)}</td><p>vless://x@<wbr>c.example.com:443#C</p>`,
    );
    const lines = text.split('\n').filter(Boolean);
    expect(lines).toEqual([VLESS_A, VLESS_B, 'vless://x@c.example.com:443#C']);
  });

  it('drops script and style contents', () => {
    expect(
      htmlToText(
        '<script>var a="vless://evil@x:1";</script><style>p{}</style>ok',
      ).trim(),
    ).toBe('ok');
  });
});

describe('SubscriptionService with HTML-wrapped responses', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let service: SubscriptionService;

  beforeEach(() => {
    service = new SubscriptionService();
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as never);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  async function parse(
    body: string,
    url = 'https://raw.githack.com/u/r/main/sub.txt',
  ) {
    fetchMock.mockResolvedValueOnce(mockResponse(body));
    return service.fetchAndParseDetailed(url);
  }

  it('parses links from a raw.githack-style HTML page with escaped query strings', async () => {
    const html = `<!DOCTYPE html><html><head><title>sub.txt</title></head><body><pre>${escapeHtml(
      VLESS_A,
    )}\n${escapeHtml(VLESS_B)}</pre></body></html>`;

    const result = await parse(html);

    expect(result.extractedLinks).toEqual([VLESS_A, VLESS_B]);
    expect(result.configs).toHaveLength(2);
    expect(result.configs[0]).toMatchObject({
      address: 'a.example.com',
      security: 'reality',
      sni: 'www.example.com',
      pbk: 'pubkey',
      sid: 'ab',
      name: 'Server A',
    });
    expect(result.configs[1]).toMatchObject({
      address: 'b.example.com',
      port: 8443,
      type: 'ws',
      path: '/ws',
      host: 'b.example.com',
    });
  });

  it('parses a plain-text body with numeric and double-escaped entities', async () => {
    const encoded = VLESS_A.replace(/&/g, '&amp;amp;')
      .replace(/=/g, '&#61;')
      .replace('://', '&#x3a;//');

    const result = await parse(encoded);

    expect(result.extractedLinks).toEqual([VLESS_A]);
    expect(result.configs[0]).toMatchObject({
      address: 'a.example.com',
      sni: 'www.example.com',
      fp: 'chrome',
    });
  });

  it('separates links placed in adjacent table cells', async () => {
    const html = `<table><tr><td>${escapeHtml(VLESS_A)}</td><td>${escapeHtml(
      VLESS_B,
    )}</td></tr></table>`;

    const result = await parse(html);

    expect(result.extractedLinks).toEqual([VLESS_A, VLESS_B]);
  });

  it('falls back to links found only in href attributes', async () => {
    const html = `<html><body><a href="${escapeHtml(VLESS_A)}">connect</a></body></html>`;

    const result = await parse(html);

    expect(result.extractedLinks).toEqual([VLESS_A]);
    expect(result.configs).toHaveLength(1);
  });

  it('decodes a Base64 subscription rendered inside <pre>', async () => {
    const payload = encode(`${VLESS_A}\n${VLESS_B}`);
    const wrapped = payload.match(/.{1,76}/g)!.join('\n');
    const html = `<html><head><title>sub</title></head><body><pre>${wrapped}</pre></body></html>`;

    const result = await parse(html);

    expect(result.extractedLinks).toEqual([VLESS_A, VLESS_B]);
    expect(result.configs).toHaveLength(2);
  });

  it('decodes an entity-escaped Base64 body', async () => {
    const payload = encode(`${VLESS_A}\n`);
    const escaped = payload.replace(/\+/g, '&#43;').replace(/=/g, '&#61;');

    const result = await parse(escaped);

    expect(result.extractedLinks).toEqual([VLESS_A]);
  });

  it('keeps extracting from Yandex Translate markup', async () => {
    const html = `<html><body><div class="tr"><span>${escapeHtml(
      VLESS_A,
    )}</span><br><span>${escapeHtml(VLESS_B)}</span></div></body></html>`;

    const result = await parse(
      html,
      'https://translate.yandex.ru/translate?url=https://example.com/sub.txt&lang=de-de',
    );

    expect(result.extractedLinks).toEqual([VLESS_A, VLESS_B]);
  });

  it('reports an HTML page with no proxy links clearly', async () => {
    await expect(
      parse(
        '<html><head><title>429 Too Many Requests</title></head><body><h1>Slow down</h1></body></html>',
      ),
    ).rejects.toThrow('HTML page without proxy links');
  });

  it('still parses an unwrapped Base64 subscription', async () => {
    const result = await parse(encode(`${VLESS_A}\n${VLESS_B}`));

    expect(result.extractedLinks).toEqual([VLESS_A, VLESS_B]);
  });
});
