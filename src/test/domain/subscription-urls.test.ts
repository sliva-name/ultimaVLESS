import { describe, expect, it } from 'vitest';
import {
  MOBILE_LIST_TURBOPAGES_DEFAULT_URL,
  MOBILE_WHITE_LIST_RAW_URL,
  YANDEX_TRANSLATED_MOBILE_LIST_URL,
  unwrapYandexTranslate,
  wrapInYandexTranslate,
} from '@/shared/subscriptionUrls';

describe('wrapInYandexTranslate', () => {
  it('wraps an HTTPS subscription in Yandex Translate', () => {
    const wrapped = wrapInYandexTranslate(MOBILE_WHITE_LIST_RAW_URL);
    const url = new URL(wrapped);
    expect(url.hostname).toBe('translate.yandex.ru');
    expect(url.pathname).toBe('/translate');
    expect(url.searchParams.get('url')).toBe(MOBILE_WHITE_LIST_RAW_URL);
    expect(url.searchParams.get('lang')).toBe('de-de');
  });

  it('keeps the query and fragment of the subscription URL', () => {
    const sub =
      'https://panel.example.com/sub/abc?format=base64&flag=a+b%2F#Name';
    const wrapped = wrapInYandexTranslate(sub);
    expect(new URL(wrapped).searchParams.get('url')).toBe(sub);
    expect(wrapped).not.toContain('&format=');
    expect(wrapped).not.toContain('#');
  });

  it('trims the input', () => {
    expect(
      unwrapYandexTranslate(
        wrapInYandexTranslate(`  ${MOBILE_WHITE_LIST_RAW_URL}\n`),
      ),
    ).toBe(MOBILE_WHITE_LIST_RAW_URL);
  });

  it('leaves links that already go through Yandex alone', () => {
    expect(wrapInYandexTranslate(YANDEX_TRANSLATED_MOBILE_LIST_URL)).toBe(
      YANDEX_TRANSLATED_MOBILE_LIST_URL,
    );
    expect(wrapInYandexTranslate(MOBILE_LIST_TURBOPAGES_DEFAULT_URL)).toBe(
      MOBILE_LIST_TURBOPAGES_DEFAULT_URL,
    );
  });

  it('leaves anything but a single HTTPS URL alone', () => {
    const links =
      'vless://11111111-2222-3333-4444-555555555555@a.example.com:443#A';
    expect(wrapInYandexTranslate(links)).toBe(links);
    expect(wrapInYandexTranslate('http://example.com/sub')).toBe(
      'http://example.com/sub',
    );
    expect(
      wrapInYandexTranslate('https://a.example.com/1 https://b.example.com/2'),
    ).toBe('https://a.example.com/1 https://b.example.com/2');
    expect(wrapInYandexTranslate('')).toBe('');
  });
});

describe('unwrapYandexTranslate', () => {
  it('reads the original URL from the built-in mobile list link', () => {
    expect(unwrapYandexTranslate(YANDEX_TRANSLATED_MOBILE_LIST_URL)).toBe(
      MOBILE_WHITE_LIST_RAW_URL,
    );
  });

  it('returns null for other links', () => {
    expect(unwrapYandexTranslate(MOBILE_WHITE_LIST_RAW_URL)).toBeNull();
    expect(unwrapYandexTranslate('https://translate.yandex.ru/')).toBeNull();
    expect(unwrapYandexTranslate('not a url')).toBeNull();
  });
});
