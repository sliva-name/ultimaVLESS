import { isValidIpOrCidr } from './networkAddresses';

/**
 * Split tunneling: destinations the user wants to keep off the tunnel. Entries
 * become `direct` routing rules, so they leave through the physical interface
 * in both proxy and TUN mode.
 *
 * Domains are stored bare (`example.com`) and expanded to Xray's
 * `domain:example.com` matcher at config build time, which covers the domain and
 * its subdomains. Advanced matchers (`full:`, `keyword:`, `geosite:`) are kept
 * verbatim. `regexp:` is rejected: an attacker-supplied or mistyped pattern can
 * stall routing for every connection.
 * @see https://xtls.github.io/config/routing.html
 */

export const MAX_SPLIT_TUNNEL_ENTRIES = 200;
const MAX_ENTRY_LENGTH = 253;

const PASSTHROUGH_DOMAIN_PREFIXES = ['domain:', 'full:', 'keyword:'] as const;
const GEO_TAG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30})(?:@[a-z0-9-]{1,30})?$/;
const DOMAIN_LABEL_PATTERN = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/;

export type SplitTunnelEntryKind = 'domain' | 'ip';

export interface SplitTunnelEntry {
  kind: SplitTunnelEntryKind;
  value: string;
}

/** Users paste addresses, not host names: keep the host and drop the rest. */
function extractHost(raw: string): string {
  let host = raw;
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(host)) {
    try {
      host = new URL(host).hostname;
    } catch {
      return '';
    }
  }
  // Strip path / query / port / credentials that survive a scheme-less paste.
  host = host.split(/[/?#]/)[0] ?? '';
  const at = host.lastIndexOf('@');
  if (at >= 0) host = host.slice(at + 1);
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end > 0 ? host.slice(1, end) : '';
  }
  const colon = host.indexOf(':');
  if (colon < 0) return host;
  // Only a port may follow the host here. Anything else is an unsupported
  // matcher prefix such as `regexp:`, which must not degrade into a domain.
  return /^\d{1,5}$/.test(host.slice(colon + 1)) ? host.slice(0, colon) : '';
}

function normalizeDomainHost(raw: string): string | null {
  let host = raw;
  // `*.example.com` and `.example.com` already mean "domain and subdomains",
  // which is exactly what the stored bare form expands to.
  if (host.startsWith('*.')) host = host.slice(2);
  while (host.startsWith('.')) host = host.slice(1);
  while (host.endsWith('.')) host = host.slice(0, -1);
  if (host.length === 0 || host.length > MAX_ENTRY_LENGTH) return null;

  let ascii = host;
  if (/[^\u0020-\u007e]/.test(host)) {
    // Punycode the IDN via the URL parser so routing compares the same form
    // Xray receives from sniffing.
    try {
      ascii = new URL(`http://${host}`).hostname;
    } catch {
      return null;
    }
  }
  const labels = ascii.split('.');
  if (!labels.every((label) => DOMAIN_LABEL_PATTERN.test(label))) return null;
  return ascii;
}

/**
 * Turns free-form user input into a stored entry, or null when it cannot be
 * used as a routing matcher.
 */
export function classifySplitTunnelEntry(
  input: unknown,
): SplitTunnelEntry | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > MAX_ENTRY_LENGTH) return null;

  if (trimmed.startsWith('geoip:')) {
    const tag = trimmed.slice('geoip:'.length);
    return GEO_TAG_PATTERN.test(tag) ? { kind: 'ip', value: trimmed } : null;
  }
  if (trimmed.startsWith('geosite:')) {
    const tag = trimmed.slice('geosite:'.length);
    return GEO_TAG_PATTERN.test(tag) ? { kind: 'domain', value: trimmed } : null;
  }
  for (const prefix of PASSTHROUGH_DOMAIN_PREFIXES) {
    if (!trimmed.startsWith(prefix)) continue;
    const host = normalizeDomainHost(trimmed.slice(prefix.length));
    return host ? { kind: 'domain', value: `${prefix}${host}` } : null;
  }

  if (isValidIpOrCidr(trimmed)) {
    return { kind: 'ip', value: trimmed };
  }

  const host = extractHost(trimmed);
  if (host.length === 0) return null;
  // A host extracted from a URL can still be an IP literal.
  if (isValidIpOrCidr(host)) {
    return { kind: 'ip', value: host };
  }
  const domain = normalizeDomainHost(host);
  return domain ? { kind: 'domain', value: domain } : null;
}

function normalizeEntries(
  value: unknown,
  kind: SplitTunnelEntryKind,
): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    const entry = classifySplitTunnelEntry(raw);
    if (!entry || entry.kind !== kind) continue;
    if (out.includes(entry.value)) continue;
    out.push(entry.value);
    if (out.length >= MAX_SPLIT_TUNNEL_ENTRIES) break;
  }
  return out;
}

export function normalizeBypassDomains(value: unknown): string[] {
  return normalizeEntries(value, 'domain');
}

export function normalizeBypassIps(value: unknown): string[] {
  return normalizeEntries(value, 'ip');
}

/**
 * Bare hosts match the domain and its subdomains; prefixed matchers are already
 * in Xray's own syntax.
 */
export function toXrayDomainMatcher(entry: string): string {
  return entry.includes(':') ? entry : `domain:${entry}`;
}
