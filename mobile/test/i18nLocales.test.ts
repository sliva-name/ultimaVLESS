import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES } from '@/shared/constants';
import { compareLocale } from '@/test/localeParity';
import { MOBILE_OVERRIDES } from '../src/ui/i18nOverrides';

describe('Android wording overrides', () => {
  it('covers every supported language', () => {
    expect(Object.keys(MOBILE_OVERRIDES).sort()).toEqual(
      [...SUPPORTED_LANGUAGES].sort(),
    );
  });

  for (const [language, locale] of Object.entries(MOBILE_OVERRIDES)) {
    if (language === 'ru') continue;
    it(`${language} has the same keys, plural forms and placeholders as ru`, () => {
      expect(compareLocale(MOBILE_OVERRIDES.ru, locale, language)).toEqual({
        missing: [],
        extra: [],
        placeholders: [],
        shape: [],
      });
    });
  }
});
