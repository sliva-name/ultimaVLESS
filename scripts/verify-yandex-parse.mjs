/**
 * One-off check: does Yandex Translate HTML contain extractable vless:// strings?
 * Run: node scripts/verify-yandex-parse.mjs
 */

const YANDEX =
  'https://translate.yandex.ru/translate?url=https://raw.githubusercontent.com/igareck/vpn-configs-for-russia/refs/heads/main/Vless-Reality-White-Lists-Rus-Mobile.txt&lang=de-de';

const RAW =
  'https://raw.githubusercontent.com/igareck/vpn-configs-for-russia/refs/heads/main/Vless-Reality-White-Lists-Rus-Mobile.txt';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
};

function expandEntities(html) {
  return html
    .replace(/&amp;/gi, '&')
    .replace(/&colon;/gi, ':')
    .replace(/&#58;/g, ':')
    .replace(/&#x3a;/gi, ':');
}

function extractLinks(text) {
  const re = /(?:vless|trojan|hysteria2):\/\/[^\s<>"'`]+/gi;
  return text.match(re) || [];
}

async function main() {
  console.log('--- Raw GitHub (reference) ---');
  const rawRes = await fetch(RAW);
  const rawText = await rawRes.text();
  const rawLinks = extractLinks(rawText);
  console.log('HTTP', rawRes.status, 'len', rawText.length, 'matches', rawLinks.length);

  console.log('\n--- Yandex Translate (app path) ---');
  const yaRes = await fetch(YANDEX, { headers: HEADERS });
  const yaHtml = await yaRes.text();
  const expanded = expandEntities(yaHtml);
  const yaLinks = extractLinks(expanded);
  console.log('HTTP', yaRes.status, 'len', yaHtml.length, 'matches', yaLinks.length);

  const uniqYa = [...new Set(yaLinks)];
  const uniqRaw = [...new Set(rawLinks)];
  console.log('unique Yandex', uniqYa.length, 'unique Raw', uniqRaw.length);

  if (uniqYa.length > 0) {
    console.log('Yandex sample:', uniqYa[0].slice(0, 120) + '...');
  } else {
    console.log('WARNING: No vless/trojan/hysteria links in Yandex HTML with this fetch.');
    console.log('Snippet (first 500 chars):', yaHtml.slice(0, 500).replace(/\s+/g, ' '));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
