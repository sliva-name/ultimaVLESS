/** Raw GitHub list (same document that Yandex Translate wraps for preview). */
export const MOBILE_WHITE_LIST_RAW_URL =
  'https://raw.githubusercontent.com/igareck/vpn-configs-for-russia/refs/heads/main/Vless-Reality-White-Lists-Rus-Mobile.txt';

/** Yandex Translate page that loads the Mobile list; response HTML is parsed for vless/trojan/hysteria links. */
export const YANDEX_TRANSLATED_MOBILE_LIST_URL =
  'https://translate.yandex.ru/translate?url=https://raw.githubusercontent.com/igareck/vpn-configs-for-russia/refs/heads/main/Vless-Reality-White-Lists-Rus-Mobile.txt&lang=de-de';

/** Older built-in default (turbopages mirror of the same Mobile list). Migrated to {@link YANDEX_TRANSLATED_MOBILE_LIST_URL}. */
export const MOBILE_LIST_TURBOPAGES_DEFAULT_URL =
  'https://translated.turbopages.org/proxy_u/de-de.ru.d55ffea1-69c9a15c-0e215049-74722d776562/https/raw.githubusercontent.com/igareck/vpn-configs-for-russia/refs/heads/main/Vless-Reality-White-Lists-Rus-Mobile.txt';
