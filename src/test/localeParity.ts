/**
 * Compares a locale against the reference one (Russian, the most complete).
 * Plural keys are compared by their base: each language needs exactly the
 * plural forms its `Intl.PluralRules` asks for (zh has only `_other`, ru has
 * `_one/_few/_many/_other`), which is what i18next looks up.
 */

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

type Tree = Record<string, unknown>;

function flatten(tree: Tree, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of flatten(value as Tree, path)) out.set(k, v);
    } else {
      out.set(path, value);
    }
  }
  return out;
}

function placeholders(value: unknown): string[] {
  const text = Array.isArray(value) ? value.join('\n') : String(value);
  return [
    ...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])),
  ].sort();
}

export interface LocaleProblems {
  missing: string[];
  extra: string[];
  placeholders: string[];
  shape: string[];
}

export function compareLocale(
  reference: Tree,
  locale: Tree,
  language: string,
): LocaleProblems {
  const ref = flatten(reference);
  const own = flatten(locale);
  const categories = new Intl.PluralRules(language).resolvedOptions()
    .pluralCategories as string[];

  const pluralBases = new Set(
    [...ref.keys()]
      .filter((key) => PLURAL_SUFFIX.test(key))
      .map((key) => key.replace(PLURAL_SUFFIX, '')),
  );

  // What this language must have: plain keys as they are, plural keys in
  // the forms of its own plural rules.
  const expected = new Map<string, unknown>();
  for (const [key, value] of ref) {
    if (!PLURAL_SUFFIX.test(key)) expected.set(key, value);
  }
  for (const base of pluralBases) {
    for (const category of categories) {
      expected.set(`${base}_${category}`, ref.get(`${base}_other`));
    }
  }

  const problems: LocaleProblems = {
    missing: [...expected.keys()].filter((key) => !own.has(key)),
    extra: [...own.keys()].filter((key) => !expected.has(key)),
    placeholders: [],
    shape: [],
  };

  for (const [key, refValue] of expected) {
    if (!own.has(key)) continue;
    const value = own.get(key);
    if (Array.isArray(refValue) !== Array.isArray(value)) {
      problems.shape.push(key);
      continue;
    }
    if (Array.isArray(refValue) && refValue.length !== (value as []).length) {
      problems.shape.push(key);
    }
    const want = placeholders(refValue).join(',');
    const got = placeholders(value).join(',');
    if (want !== got)
      problems.placeholders.push(`${key}: {${got}} ≠ {${want}}`);
  }

  return problems;
}
