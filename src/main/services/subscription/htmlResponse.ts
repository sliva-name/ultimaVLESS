const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  colon: ':',
  sol: '/',
  quest: '?',
  equals: '=',
  num: '#',
  percnt: '%',
  plus: '+',
  commat: '@',
  lowbar: '_',
  period: '.',
  comma: ',',
  semi: ';',
  excl: '!',
  lsqb: '[',
  rsqb: ']',
  lbrack: '[',
  rbrack: ']',
  newline: '\n',
  tab: '\t',
};

const ENTITY_PATTERN = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));/g;

/** Upper bound on nested decoding passes (handles `&amp;amp;` from double-escaping proxies). */
const MAX_ENTITY_DECODE_PASSES = 3;

function decodeEntitiesOnce(input: string): string {
  return input.replace(
    ENTITY_PATTERN,
    (
      match,
      dec: string | undefined,
      hex: string | undefined,
      name?: string,
    ) => {
      if (name !== undefined) {
        return NAMED_ENTITIES[name.toLowerCase()] ?? match;
      }
      const codePoint = dec !== undefined ? Number(dec) : parseInt(hex!, 16);
      if (
        !Number.isInteger(codePoint) ||
        codePoint <= 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        return match;
      }
      return String.fromCodePoint(codePoint);
    },
  );
}

/**
 * Decode HTML character references (named, decimal and hex) that proxies such as
 * raw.githack.com or translate.yandex.ru leave in subscription bodies. Repeats a
 * few times so double-escaped sequences like `&amp;amp;` collapse to `&`.
 */
export function decodeHtmlEntities(input: string): string {
  let current = input;
  for (let pass = 0; pass < MAX_ENTITY_DECODE_PASSES; pass += 1) {
    const next = decodeEntitiesOnce(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

/** True when the body is an HTML document or fragment rather than a plain subscription. */
export function looksLikeHtml(input: string): boolean {
  const head = input.trimStart().slice(0, 2048).toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) {
    return true;
  }
  return /<(?:html|head|body|pre|div|p|br|span|table|textarea|code)\b[^>]*>/i.test(
    input,
  );
}

/**
 * Reduce an HTML page to its visible text: drop script/style/comments, turn every
 * tag except `<wbr>` into a line break (so neighbouring links never glue
 * together), then decode
 * entities. Attribute values are discarded; callers that need links from `href`
 * attributes should fall back to {@link decodeHtmlEntities} on the raw markup.
 */
export function htmlToText(html: string): string {
  const withoutTags = html
    .replace(/<!--[\s\S]*?-->/g, '\n')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '\n')
    // <wbr> is a soft wrap hint that pages insert inside long URLs.
    .replace(/<wbr\s*\/?>/gi, '')
    .replace(/<[^>]*>/g, '\n');
  return decodeHtmlEntities(withoutTags);
}

const BASE64_LINE_PATTERN = /^[A-Za-z0-9+/=_-]+$/;
const MIN_BASE64_BLOCK_LENGTH = 16;

/**
 * Runs of consecutive Base64-looking lines in an HTML page's text that could be
 * a subscription payload (e.g. a wrapped body rendered inside `<pre>`), longest
 * first. Blank or non-Base64 lines (titles, headings) split the runs so they do
 * not corrupt the payload.
 */
export function findBase64Candidates(text: string): string[] {
  const blocks: string[] = [];
  let current = '';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line && BASE64_LINE_PATTERN.test(line)) {
      current += line;
      continue;
    }
    if (current.length >= MIN_BASE64_BLOCK_LENGTH) blocks.push(current);
    current = '';
  }
  if (current.length >= MIN_BASE64_BLOCK_LENGTH) blocks.push(current);
  return blocks.sort((a, b) => b.length - a.length);
}
