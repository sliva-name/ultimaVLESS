import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES } from '@/shared/constants';
import { compareLocale } from '@/test/localeParity';
import { localizeError } from '@/shared/localizeError';
import { ERROR_PATTERNS } from '@/shared/errorPhrases/patterns';
import { ru as errorRu } from '@/shared/errorPhrases/ru';
import { zh as errorZh } from '@/shared/errorPhrases/zh';
import { fa as errorFa } from '@/shared/errorPhrases/fa';
import { es as errorEs } from '@/shared/errorPhrases/es';
import { tr as errorTr } from '@/shared/errorPhrases/tr';

import en from '@/renderer/locales/en.json';
import ru from '@/renderer/locales/ru.json';
import zh from '@/renderer/locales/zh.json';
import fa from '@/renderer/locales/fa.json';
import es from '@/renderer/locales/es.json';
import tr from '@/renderer/locales/tr.json';

const locales = { en, ru, zh, fa, es, tr };

describe('desktop locales', () => {
  it('has a locale file for every supported language', () => {
    expect(Object.keys(locales).sort()).toEqual(
      [...SUPPORTED_LANGUAGES].sort(),
    );
  });

  for (const [language, locale] of Object.entries(locales)) {
    if (language === 'ru') continue;
    it(`${language} has the same keys, plural forms and placeholders as ru`, () => {
      expect(compareLocale(ru, locale, language)).toEqual({
        missing: [],
        extra: [],
        placeholders: [],
        shape: [],
      });
    });
  }
});

describe('error phrase translations', () => {
  const tables = {
    ru: errorRu,
    zh: errorZh,
    fa: errorFa,
    es: errorEs,
    tr: errorTr,
  };

  it('has a table for every language but English, the source text', () => {
    expect(Object.keys(tables).sort()).toEqual(
      SUPPORTED_LANGUAGES.filter((code) => code !== 'en').sort(),
    );
  });

  for (const [language, phrases] of Object.entries(tables)) {
    it(`${language} only uses groups its pattern captures`, () => {
      const wrong = Object.entries(ERROR_PATTERNS).flatMap(([id, pattern]) => {
        const groups = new Set(
          [...pattern.source.matchAll(/\(\?<(\w+)>/g)].map((m) => m[1]),
        );
        const used = [
          ...phrases[id as keyof typeof phrases].matchAll(/\$<(\w+)>/g),
        ].map((m) => m[1]);
        return used
          .filter((name) => !groups.has(name))
          .map((name) => `${id}: ${name}`);
      });
      expect(wrong).toEqual([]);
    });

    it(`${language} keeps every group the Russian wording keeps`, () => {
      const lost = Object.keys(ERROR_PATTERNS).flatMap((id) => {
        const key = id as keyof typeof phrases;
        const groups = (text: string) =>
          [...text.matchAll(/\$<(\w+)>/g)]
            .map((m) => m[1])
            .sort()
            .join(',');
        return groups(phrases[key]) === groups(errorRu[key]) ? [] : [id];
      });
      expect(lost).toEqual([]);
    });
  }

  it('translates a startup error into every language', () => {
    const message =
      "Error invoking remote method 'connect': Error: Port 10808 on 127.0.0.1 is already used by another program (another VPN or proxy client?). Close it and connect again.";
    expect(localizeError(message, 'en')).toBe(
      'Port 10808 on 127.0.0.1 is already used by another program (another VPN or proxy client?). Close it and connect again.',
    );
    for (const language of ['ru', 'zh', 'fa', 'es', 'tr']) {
      const localized = localizeError(message, language);
      expect(localized).toContain('10808');
      expect(localized).not.toMatch(/already used/);
    }
  });
});
