/**
 * Address validation shared by the main process and the renderer. Node's
 * `net.isIP` is unavailable in the renderer bundle, so the checks are
 * implemented without platform APIs.
 */

/** Strict IPv4 dotted-quad without leading zeros (except `0`). */
export function isValidIpv4Address(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    return n >= 0 && n <= 255 && String(n) === part;
  });
}

function splitHextets(segment: string): string[] | null {
  if (segment.length === 0) return [];
  const groups = segment.split(':');
  // An empty group here means ':::' or a stray leading/trailing colon.
  return groups.some((group) => group.length === 0) ? null : groups;
}

export function isValidIpv6Address(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const address = value.trim().toLowerCase();
  if (address.length === 0 || address.length > 45) return false;
  if (!/^[0-9a-f:.]+$/.test(address)) return false;

  const halves = address.split('::');
  if (halves.length > 2) return false;

  const head = splitHextets(halves[0] ?? '');
  const tail = halves.length === 2 ? splitHextets(halves[1] ?? '') : [];
  if (head === null || tail === null) return false;

  const groups = [...head, ...tail];
  const last = groups[groups.length - 1];
  const hasEmbeddedIpv4 = !!last && last.includes('.');
  if (hasEmbeddedIpv4 && !isValidIpv4Address(last)) return false;

  const hextets = hasEmbeddedIpv4 ? groups.slice(0, -1) : groups;
  if (!hextets.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return false;

  // An embedded IPv4 tail occupies the last two 16-bit groups.
  const groupCount = hextets.length + (hasEmbeddedIpv4 ? 2 : 0);
  // `::` stands for at least one all-zero group, so it cannot appear in a
  // fully specified address.
  return halves.length === 2 ? groupCount <= 7 : groupCount === 8;
}

/** Accepts a bare IPv4/IPv6 address or a CIDR block such as `10.0.0.0/8`. */
export function isValidIpOrCidr(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = value.trim().split('/');
  if (parts.length > 2) return false;

  const [address, prefixRaw] = parts;
  const isIpv4 = isValidIpv4Address(address);
  const isIpv6 = !isIpv4 && isValidIpv6Address(address);
  if (!isIpv4 && !isIpv6) return false;
  if (prefixRaw === undefined) return true;

  if (!/^\d{1,3}$/.test(prefixRaw)) return false;
  const prefix = Number(prefixRaw);
  return prefix >= 0 && prefix <= (isIpv4 ? 32 : 128);
}

function ipv4ToInt(address: string): number | null {
  if (!isValidIpv4Address(address)) return null;
  const [a, b, c, d] = address.split('.').map(Number);
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function ipv4InCidr(address: string, base: string, prefix: number): boolean {
  const ip = ipv4ToInt(address);
  const network = ipv4ToInt(base);
  if (ip == null || network == null) return false;
  if (prefix === 0) return true;
  const mask = prefix === 32 ? 0xffffffff : (~((1 << (32 - prefix)) - 1)) >>> 0;
  return (ip & mask) === (network & mask);
}

const PRIVATE_IPV4_CIDRS: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
];

function expandIpv6Hextets(address: string): number[] | null {
  const trimmed = address.trim().toLowerCase();
  if (!isValidIpv6Address(trimmed)) return null;

  const halves = trimmed.split('::');
  const parseSide = (side: string | undefined): string[] => {
    if (!side) return [];
    return side.split(':').filter((group) => group.length > 0);
  };

  const head = parseSide(halves[0]);
  const tail = halves.length === 2 ? parseSide(halves[1]) : [];
  const last = [...head, ...tail].at(-1);
  const hasEmbeddedIpv4 = !!last && last.includes('.');
  const hextetTokens = hasEmbeddedIpv4
    ? [...head, ...tail].slice(0, -1)
    : [...head, ...tail];
  const missing = 8 - hextetTokens.length - (hasEmbeddedIpv4 ? 2 : 0);
  const zeros = halves.length === 2 ? Array.from({ length: missing }, () => '0') : [];
  const tokens = [...head, ...zeros, ...(hasEmbeddedIpv4 ? tail.slice(0, -1) : tail)];
  const hextets = tokens.map((token) => Number.parseInt(token, 16));
  if (hasEmbeddedIpv4 && last) {
    const ipv4 = ipv4ToInt(last);
    if (ipv4 == null) return null;
    hextets.push((ipv4 >>> 16) & 0xffff, ipv4 & 0xffff);
  }
  return hextets.length === 8 && hextets.every((n) => Number.isInteger(n))
    ? hextets
    : null;
}

function embeddedIpv4FromIpv6(hextets: number[]): string | null {
  const mapped =
    hextets[0] === 0 &&
    hextets[1] === 0 &&
    hextets[2] === 0 &&
    hextets[3] === 0 &&
    hextets[4] === 0 &&
    hextets[5] === 0xffff;
  if (!mapped) return null;
  const hi = hextets[6];
  const lo = hextets[7];
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

function isPrivateOrReservedIpv4(address: string): boolean {
  return PRIVATE_IPV4_CIDRS.some(([base, prefix]) =>
    ipv4InCidr(address, base, prefix),
  );
}

function isPrivateOrReservedIpv6(address: string): boolean {
  const hextets = expandIpv6Hextets(address);
  if (!hextets) return false;

  const embedded = embeddedIpv4FromIpv6(hextets);
  if (embedded) return isPrivateOrReservedIpv4(embedded);

  const unspecified = hextets.every((n) => n === 0);
  if (unspecified) return true;
  if (hextets[0] === 0 && hextets.slice(1, 7).every((n) => n === 0) && hextets[7] === 1) {
    return true;
  }
  // Unique-local fc00::/7 and link-local fe80::/10.
  if ((hextets[0] & 0xfe00) === 0xfc00) return true;
  if ((hextets[0] & 0xffc0) === 0xfe80) return true;
  return false;
}

/**
 * Hosts that a subscription fetch must not target: loopback, link-local,
 * RFC1918, CGNAT, ULA, and IPv4-mapped forms of the same ranges.
 */
export function isPrivateOrReservedHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
    return true;
  }
  if (isValidIpv4Address(normalized)) {
    return isPrivateOrReservedIpv4(normalized);
  }
  if (isValidIpv6Address(normalized)) {
    return isPrivateOrReservedIpv6(normalized);
  }
  return false;
}
