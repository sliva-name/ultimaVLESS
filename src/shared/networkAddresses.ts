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
