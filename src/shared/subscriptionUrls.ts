/** Raw GitHub list (same document that Yandex Translate wraps for preview). */
export const MOBILE_WHITE_LIST_RAW_URL =
  'https://raw.githubusercontent.com/igareck/vpn-configs-for-russia/refs/heads/main/Vless-Reality-White-Lists-Rus-Mobile.txt';

/** Yandex Translate page that loads the Mobile list; response HTML is parsed for vless/trojan/hysteria links. */
export const YANDEX_TRANSLATED_MOBILE_LIST_URL =
  'https://translate.yandex.ru/translate?url=https://raw.githubusercontent.com/igareck/vpn-configs-for-russia/refs/heads/main/Vless-Reality-White-Lists-Rus-Mobile.txt&lang=de-de';

/** Older built-in default (turbopages mirror of the same Mobile list). Migrated to {@link YANDEX_TRANSLATED_MOBILE_LIST_URL}. */
export const MOBILE_LIST_TURBOPAGES_DEFAULT_URL =
  'https://translated.turbopages.org/proxy_u/de-de.ru.d55ffea1-69c9a15c-0e215049-74722d776562/https/raw.githubusercontent.com/igareck/vpn-configs-for-russia/refs/heads/main/Vless-Reality-White-Lists-Rus-Mobile.txt';

const YANDEX_TRANSLATE_HOST = 'translate.yandex.ru';

/** Hosts that already serve a subscription through Yandex Translate. */
const YANDEX_PROXY_HOSTS = new Set([
  YANDEX_TRANSLATE_HOST,
  'translated.turbopages.org',
]);

function parseHttpsUrl(input: string): URL | null {
  if (!input || /\s/.test(input)) return null;
  try {
    const url = new URL(input);
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * Routes a subscription through Yandex Translate, which stays reachable under
 * mobile white lists. The `de-de` pair leaves the text untranslated. The inner
 * URL is percent-encoded: unencoded, Yandex cuts it at the first `&`. Anything
 * but a single HTTPS URL (pasted links, `http:`) and URLs already served by
 * Yandex come back unchanged.
 */
export function wrapInYandexTranslate(input: string): string {
  const trimmed = input.trim();
  const url = parseHttpsUrl(trimmed);
  if (!url || YANDEX_PROXY_HOSTS.has(url.hostname)) return trimmed;
  return `https://${YANDEX_TRANSLATE_HOST}/translate?url=${encodeURIComponent(trimmed)}&lang=de-de`;
}

/** The original subscription URL behind a Yandex Translate link, else null. */
export function unwrapYandexTranslate(input: string): string | null {
  const url = parseHttpsUrl(input.trim());
  if (url?.hostname !== YANDEX_TRANSLATE_HOST) return null;
  return url.searchParams.get('url') || null;
}
