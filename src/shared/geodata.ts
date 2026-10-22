/**
 * Lists in the `geoip.dat` / `geosite.dat` bundled with Xray. Since v26.10.21
 * the release ships XTLS/Xray-rules-dat (geoip lite: only cn/ru/ir among the
 * countries), and Xray refuses to start on a `geoip:` / `geosite:` tag the
 * file lacks, so entries are checked against these before they reach a config.
 */
export interface GeodataTags {
  /** Lower-case tags, e.g. `private`, `ru`. */
  geoip: string[];
  /** Lower-case tags, e.g. `category-ads-all`. */
  geosite: string[];
}

export interface GeodataCatalog {
  geoip: ReadonlySet<string>;
  geosite: ReadonlySet<string>;
}

export interface GeodataReference {
  file: keyof GeodataTags;
  tag: string;
}

export function toGeodataCatalog(tags: GeodataTags): GeodataCatalog {
  return {
    geoip: new Set(tags.geoip.map((tag) => tag.toLowerCase())),
    geosite: new Set(tags.geosite.map((tag) => tag.toLowerCase())),
  };
}

/**
 * Follows Xray's `common/geodata` parser: an IP entry may be negated before
 * and after the prefix (`!geoip:!cn`), a domain entry may carry attributes
 * (`geosite:google@cn`). `ext:` files and plain hosts/addresses are not
 * references to the bundled lists.
 */
export function parseGeodataReference(entry: string): GeodataReference | null {
  const ip = entry.replace(/^!+/, '');
  if (ip.startsWith('geoip:')) {
    return {
      file: 'geoip',
      tag: ip.slice('geoip:'.length).replace(/^!+/, '').toLowerCase(),
    };
  }
  if (entry.startsWith('geosite:')) {
    const [tag] = entry.slice('geosite:'.length).split('@');
    return { file: 'geosite', tag: tag.toLowerCase() };
  }
  return null;
}

/** False only for a `geoip:` / `geosite:` entry whose tag the list lacks. */
export function isGeodataEntryAvailable(
  entry: string,
  catalog: GeodataCatalog,
): boolean {
  const reference = parseGeodataReference(entry);
  return !reference || catalog[reference.file].has(reference.tag);
}
