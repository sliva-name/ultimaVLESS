import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { type UiLanguage, SUPPORTED_LANGUAGES, isSupportedLanguage} from '@/shared/constants'

const LOCALE_BY_LANGUAGE: Record<UiLanguage, string> = {
  en: 'en-US',
  ru: 'ru-RU',
  zh: 'zh-CN',
  fa: 'fa-IR',
  es: 'es-ES',
  tr: 'tr-TR',
};

const padZero = (value: number) => value.toString().padStart(2, '0');

/** Session length as HH:MM:SS. */
export function formatDuration(totalMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${padZero(hours)}:${padZero(minutes)}:${padZero(seconds)}`;
}

function scaleBytes(bytes: number): { value: number; unit: number } {
  let value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  let unit = 0;
  while (value >= 1024 && unit < 4) {
    value /= 1024;
    unit += 1;
  }
  return { value, unit };
}

/**
 * Sizes, rates and times in the UI language: decimal comma and Russian
 * units in Russian, as the rest of the interface.
 */
export function useFormat() {
  const { t, i18n } = useTranslation();

  const languageTag = i18n.resolvedLanguage ?? i18n.language;
  const languageCode = languageTag.toLowerCase().split(/[-_]/)[0];
  const language: UiLanguage = isSupportedLanguage(languageCode)
    ? languageCode
    : 'en';

  return useMemo(() => {
    const locale = LOCALE_BY_LANGUAGE[language];
    const units = t('units.bytes', { returnObjects: true }) as string[];

    const number = (value: number, digits: number) =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        useGrouping: false,
      }).format(value);

    const bytes = (amount: number) => {
      const { value, unit } = scaleBytes(amount);
      const digits = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
      return `${number(value, digits)} ${units[unit]}`;
    };

    const rate = (bytesPerSecond: number) => {
      const { value, unit } = scaleBytes(bytesPerSecond);
      const digits = unit === 0 || value >= 10 ? 0 : 1;

      return t('units.perSecond', {
        value: `${number(value, digits)} ${units[unit]}`,
      });
    };

    const clock = (epochMs: number) =>
      new Date(epochMs).toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
      });

    const ago = (sinceMs: number) => {
      const seconds = Math.max(0, Math.round(sinceMs / 1000));
      if (seconds < 60) return t('units.seconds', { count: seconds });

      const minutes = Math.round(seconds / 60);
      if (minutes < 60) return t('units.minutes', { count: minutes });

      const hours = Math.round(minutes / 60);
      if (hours < 24) return t('units.hours', { count: hours });

      return t('units.days', { count: Math.round(hours / 24) });
    };

    return { bytes, rate, clock, ago, duration: formatDuration };
  }, [language, t]);
}