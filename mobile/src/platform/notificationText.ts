import type { RuntimePorts } from '@/shared/constants';
import type { UiLanguage } from '@/main/services/ConfigService';
import type { NotificationText } from '../native/UltimaCore';

/**
 * Notification wording the native side cannot localize itself: it only
 * formats the numbers. Same words and units as the UI.
 */
const STRINGS: Record<
  UiLanguage,
  Pick<NotificationText, 'rateUnits' | 'decimalSeparator'> & {
    proxyOnly: string;
  }
> = {
  ru: {
    proxyOnly: 'Только прокси',
    rateUnits: ['Б/с', 'КБ/с', 'МБ/с'],
    decimalSeparator: ',',
  },
  en: {
    proxyOnly: 'Proxy only',
    rateUnits: ['B/s', 'KB/s', 'MB/s'],
    decimalSeparator: '.',
  },
};

/**
 * The server name is the notification title; the text says the mode:
 * "VPN · ↓ 3,2 МБ/с · ↑ 140 КБ/с" (speed added natively) or
 * "Только прокси · SOCKS5 :10808 · HTTP :10809".
 */
export function buildNotificationText(
  language: UiLanguage,
  ports: RuntimePorts,
  disconnect: string,
): NotificationText {
  const strings = STRINGS[language] ?? STRINGS.en;
  return {
    channelName: 'VPN',
    vpn: 'VPN',
    proxyOnly: `${strings.proxyOnly} · SOCKS5 :${ports.socks} · HTTP :${ports.http}`,
    disconnect,
    rateUnits: strings.rateUnits,
    decimalSeparator: strings.decimalSeparator,
  };
}
