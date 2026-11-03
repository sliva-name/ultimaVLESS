import { describe, it, expect } from 'vitest';

import en from '../../renderer/locales/en.json';
import ru from '../../renderer/locales/ru.json';
import zh from '../../renderer/locales/zh.json';
import fa from '../../renderer/locales/fa.json';
import es from '../../renderer/locales/es.json';
import tr from '../../renderer/locales/tr.json';

const locales = { en, zh, fa, es, tr, };

function flattenKeys(
  obj: Record<string, any>,
  prefix = '',
): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;

    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      return flattenKeys(value, path);
    }

    return [path];
  });
}

function getPlaceholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)]
    .map(match => match[1])
    .sort();
}

describe('Locale translations', () => {
  // Russian is reference
  const referenceKeys = flattenKeys(ru);

  for (const [language, translations] of Object.entries(locales)) {
    it(`${language}: should contain all Russian keys`, () => {
      const actualKeys = flattenKeys(translations);

      const missing = referenceKeys.filter(
        key => !actualKeys.includes(key),
      );

      const extra = actualKeys.filter(
        key => !referenceKeys.includes(key),
      );

      expect(
        { missing, extra },
        `Locale ${language} has different keys`,
      ).toEqual({ missing: [], extra: [] });
    });

    it(`${language}: should have matching placeholders`, () => {
      const translation = translations as Record<string, any>;

      for (const key of referenceKeys) {
        const getValue = (obj: any, path: string) =>
          path.split('.').reduce((current, part) => current?.[part], obj);

        const ruValue = getValue(ru, key);
        const translatedValue = getValue(translation, key);

        if (
          typeof ruValue !== 'string' ||
          typeof translatedValue !== 'string'
        ) {
          continue;
        }

        expect(
          getPlaceholders(translatedValue),
          `${language}: incorrect placeholders in ${key}`,
        ).toEqual(getPlaceholders(ruValue));
      }
    });
  }
});
