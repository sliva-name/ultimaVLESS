/**
 * Utility functions for country flag detection and display
 */

// Mapping of country names/codes to ISO 3166-1 alpha-2 codes
const COUNTRY_CODE_MAP: Record<string, string> = {
  US: 'US',
  USA: 'US',
  'United States': 'US',
  America: 'US',
  GB: 'GB',
  UK: 'GB',
  'United Kingdom': 'GB',
  Britain: 'GB',
  DE: 'DE',
  Germany: 'DE',
  Deutschland: 'DE',
  FR: 'FR',
  France: 'FR',
  IT: 'IT',
  Italy: 'IT',
  Italia: 'IT',
  ES: 'ES',
  Spain: 'ES',
  España: 'ES',
  NL: 'NL',
  Netherlands: 'NL',
  Holland: 'NL',
  BE: 'BE',
  Belgium: 'BE',
  CH: 'CH',
  Switzerland: 'CH',
  Schweiz: 'CH',
  AT: 'AT',
  Austria: 'AT',
  Österreich: 'AT',
  Австрия: 'AT',
  SE: 'SE',
  Sweden: 'SE',
  Sverige: 'SE',
  NO: 'NO',
  Norway: 'NO',
  Norge: 'NO',
  DK: 'DK',
  Denmark: 'DK',
  Danmark: 'DK',
  FI: 'FI',
  Finland: 'FI',
  Suomi: 'FI',
  EE: 'EE',
  EST: 'EE',
  Estonia: 'EE',
  Eesti: 'EE',
  LV: 'LV',
  LVA: 'LV',
  Latvia: 'LV',
  Latvija: 'LV',
  LT: 'LT',
  LTU: 'LT',
  Lithuania: 'LT',
  Lietuva: 'LT',
  PL: 'PL',
  Poland: 'PL',
  Polska: 'PL',
  CZ: 'CZ',
  Czech: 'CZ',
  'Czech Republic': 'CZ',
  RO: 'RO',
  Romania: 'RO',
  România: 'RO',
  HU: 'HU',
  Hungary: 'HU',
  Magyarország: 'HU',
  GR: 'GR',
  Greece: 'GR',
  Ελλάδα: 'GR',
  PT: 'PT',
  Portugal: 'PT',
  IE: 'IE',
  Ireland: 'IE',
  Éire: 'IE',
  RU: 'RU',
  RUS: 'RU',
  Russia: 'RU',
  Россия: 'RU',
  Russian: 'RU',
  'Russian Federation': 'RU',
  UA: 'UA',
  Ukraine: 'UA',
  Україна: 'UA',
  TR: 'TR',
  Turkey: 'TR',
  Türkiye: 'TR',
  JP: 'JP',
  Japan: 'JP',
  日本: 'JP',
  KR: 'KR',
  Korea: 'KR',
  'South Korea': 'KR',
  한국: 'KR',
  CN: 'CN',
  China: 'CN',
  中国: 'CN',
  SG: 'SG',
  Singapore: 'SG',
  新加坡: 'SG',
  HK: 'HK',
  'Hong Kong': 'HK',
  香港: 'HK',
  TW: 'TW',
  Taiwan: 'TW',
  台灣: 'TW',
  IN: 'IN',
  India: 'IN',
  भारत: 'IN',
  TH: 'TH',
  Thailand: 'TH',
  ประเทศไทย: 'TH',
  VN: 'VN',
  Vietnam: 'VN',
  'Việt Nam': 'VN',
  PH: 'PH',
  Philippines: 'PH',
  ID: 'ID',
  Indonesia: 'ID',
  MY: 'MY',
  Malaysia: 'MY',
  AU: 'AU',
  AUS: 'AU',
  Australia: 'AU',
  Австралия: 'AU',
  NZ: 'NZ',
  'New Zealand': 'NZ',
  CA: 'CA',
  Canada: 'CA',
  MX: 'MX',
  Mexico: 'MX',
  México: 'MX',
  BR: 'BR',
  Brazil: 'BR',
  Brasil: 'BR',
  AR: 'AR',
  Argentina: 'AR',
  CL: 'CL',
  Chile: 'CL',
  CO: 'CO',
  Colombia: 'CO',
  ZA: 'ZA',
  'South Africa': 'ZA',
  EG: 'EG',
  Egypt: 'EG',
  مصر: 'EG',
  IL: 'IL',
  Israel: 'IL',
  ישראל: 'IL',
  AE: 'AE',
  UAE: 'AE',
  'United Arab Emirates': 'AE',
  SA: 'SA',
  'Saudi Arabia': 'SA',
  السعودية: 'SA',
};

// Common city names that indicate countries
const CITY_COUNTRY_MAP: Record<string, string> = {
  'New York': 'US',
  'Los Angeles': 'US',
  Chicago: 'US',
  Miami: 'US',
  Dallas: 'US',
  London: 'GB',
  Manchester: 'GB',
  Birmingham: 'GB',
  Berlin: 'DE',
  Frankfurt: 'DE',
  Munich: 'DE',
  Hamburg: 'DE',
  Paris: 'FR',
  Marseille: 'FR',
  Lyon: 'FR',
  Rome: 'IT',
  Milan: 'IT',
  Naples: 'IT',
  Madrid: 'ES',
  Barcelona: 'ES',
  Amsterdam: 'NL',
  Rotterdam: 'NL',
  Brussels: 'BE',
  Zurich: 'CH',
  Geneva: 'CH',
  Vienna: 'AT',
  Stockholm: 'SE',
  Gothenburg: 'SE',
  Oslo: 'NO',
  Copenhagen: 'DK',
  Helsinki: 'FI',
  Tallinn: 'EE',
  Riga: 'LV',
  Vilnius: 'LT',
  Kaunas: 'LT',
  Warsaw: 'PL',
  Krakow: 'PL',
  Prague: 'CZ',
  Bucharest: 'RO',
  Budapest: 'HU',
  Athens: 'GR',
  Lisbon: 'PT',
  Dublin: 'IE',
  Moscow: 'RU',
  'Saint Petersburg': 'RU',
  'St. Petersburg': 'RU',
  'St Petersburg': 'RU',
  Novosibirsk: 'RU',
  Yekaterinburg: 'RU',
  Kazan: 'RU',
  'Nizhny Novgorod': 'RU',
  Chelyabinsk: 'RU',
  Samara: 'RU',
  Omsk: 'RU',
  Rostov: 'RU',
  Ufa: 'RU',
  Krasnoyarsk: 'RU',
  Voronezh: 'RU',
  Perm: 'RU',
  Volgograd: 'RU',
  Kiev: 'UA',
  Kyiv: 'UA',
  Istanbul: 'TR',
  Ankara: 'TR',
  Tokyo: 'JP',
  Osaka: 'JP',
  Yokohama: 'JP',
  Seoul: 'KR',
  Beijing: 'CN',
  Shanghai: 'CN',
  Guangzhou: 'CN',
  Shenzhen: 'CN',
  Singapore: 'SG',
  'Hong Kong': 'HK',
  Taipei: 'TW',
  Mumbai: 'IN',
  Delhi: 'IN',
  Bangalore: 'IN',
  Bangkok: 'TH',
  'Ho Chi Minh': 'VN',
  Hanoi: 'VN',
  Manila: 'PH',
  Jakarta: 'ID',
  'Kuala Lumpur': 'MY',
  Sydney: 'AU',
  Melbourne: 'AU',
  Auckland: 'NZ',
  Toronto: 'CA',
  Vancouver: 'CA',
  Montreal: 'CA',
  'Mexico City': 'MX',
  'São Paulo': 'BR',
  'Rio de Janeiro': 'BR',
  'Buenos Aires': 'AR',
  Santiago: 'CL',
  Bogotá: 'CO',
  Johannesburg: 'ZA',
  'Cape Town': 'ZA',
  Cairo: 'EG',
  'Tel Aviv': 'IL',
  Jerusalem: 'IL',
  Dubai: 'AE',
  'Abu Dhabi': 'AE',
  Riyadh: 'SA',
  Jeddah: 'SA',
};

/**
 * Extracts country code from text
 */
function extractCountryCode(text: string): string | null {
  if (!text) return null;

  const upperText = text.toUpperCase();
  const lowerText = text.toLowerCase();

  // Check flag emojis
  const flagEmojiRegex = /[\u{1F1E6}-\u{1F1FF}]{2}/gu;
  const emojiMatches = Array.from(text.matchAll(flagEmojiRegex));
  for (const match of emojiMatches) {
    const codePoint1 = match[0].codePointAt(0);
    const codePoint2 = match[0].codePointAt(2);
    if (codePoint1 && codePoint2) {
      const code =
        String.fromCharCode(codePoint1 - 0x1f1e6 + 65) +
        String.fromCharCode(codePoint2 - 0x1f1e6 + 65);
      if (code !== 'EU' && COUNTRY_CODE_MAP[code]) {
        return COUNTRY_CODE_MAP[code];
      }
    }
  }

  // Check country names (longer names first)
  for (const [name, code] of Object.entries(COUNTRY_CODE_MAP)) {
    if (name.length > 2 && lowerText.includes(name.toLowerCase())) {
      return code;
    }
  }

  // Check city names
  for (const [city, code] of Object.entries(CITY_COUNTRY_MAP)) {
    if (lowerText.includes(city.toLowerCase())) {
      return code;
    }
  }

  // Check 3-letter codes
  const code3Match = upperText.match(/\b([A-Z]{3})(?:[-_]?\d+)?\b/);
  if (code3Match && COUNTRY_CODE_MAP[code3Match[1]]) {
    return COUNTRY_CODE_MAP[code3Match[1]];
  }

  // Check 2-letter codes
  const code2Matches = Array.from(
    upperText.matchAll(/\b([A-Z]{2})(?:[-_]?\d+)?\b/g),
  );
  for (const match of code2Matches) {
    if (match[1] && COUNTRY_CODE_MAP[match[1]]) {
      return COUNTRY_CODE_MAP[match[1]];
    }
  }

  return null;
}

/**
 * Gets the ISO 3166-1 alpha-2 country code for a given server configuration
 */
export function getCountryCode(server: {
  name: string;
  address: string;
}): string | null {
  return extractCountryCode(server.name) || extractCountryCode(server.address);
}
