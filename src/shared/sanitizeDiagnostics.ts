const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const IPV4_PATTERN = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g;
/**
 * Deliberately loose: candidates are filtered in {@link redactIpv6}, because any
 * regex tight enough to exclude clock times (`19:56:36`) also misses valid
 * compressed addresses.
 */
const IPV6_PATTERN = /\b[0-9a-f]{0,4}(?::{1,2}[0-9a-f]{0,4}){2,7}\b/gi;
/** `scheme://user:pass@host` — subscription URLs sometimes embed credentials. */
const BASIC_AUTH_PATTERN = /(\bhttps?:\/\/)[^\s/@:]+:[^\s/@]+@/gi;

/** IPs we deliberately keep as-is because they never reveal private identity. */
const PRESERVED_IPS = new Set(['127.0.0.1', '0.0.0.0', '255.255.255.255']);

function redactIpv4(match: string): string {
  if (PRESERVED_IPS.has(match)) return match;
  // Private CIDR ranges, loopback, link-local — safe to preserve in diagnostics.
  const octets = match.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return match;
  }
  const [a, b] = octets;
  if (a === 0 || a === 127) return match;
  if (a === 10) return match;
  if (a === 169 && b === 254) return match;
  if (a === 172 && b >= 16 && b <= 31) return match;
  if (a === 192 && b === 168) return match;
  return '***.***.***.***';
}

function redactIpv6(match: string): string {
  const compressed = match.includes('::');
  const groups = match.split(':').filter((group) => group.length > 0);
  // A bare `h:h:h` run is far more likely a timestamp than an address.
  if (!compressed && groups.length !== 8) return match;

  const lower = match.toLowerCase();
  // Loopback, unspecified, link-local and unique-local reveal no identity, and
  // they matter for diagnosing TUN/DNS behaviour.
  if (lower === '::' || lower === '::1' || lower.startsWith('::')) return match;
  if (lower.startsWith('fe80')) return match;
  if (/^f[cd][0-9a-f]{0,2}/.test(lower)) return match;
  return '****:****::****';
}

export function sanitizeSensitiveText(text: string): string {
  return text
    .replace(UUID_PATTERN, '***-UUID-***')
    .replace(BASIC_AUTH_PATTERN, '$1***:***@')
    .replace(IPV6_PATTERN, redactIpv6)
    .replace(IPV4_PATTERN, redactIpv4);
}

export const REDACTED = '***REDACTED***';

/**
 * Field names whose value is a credential. Pattern-based redaction cannot catch
 * these: a Trojan password or a WireGuard key is an arbitrary string that looks
 * like nothing in particular.
 */
const SECRET_KEY_NAMES = new Set([
  'id',
  'uuid',
  'password',
  'pass',
  'psk',
  'pbk',
  'sid',
  'spx',
  'shortid',
  'publickey',
  'privatekey',
  'secretkey',
  'wgsecretkey',
  'presharedkey',
  'authorization',
  'cookie',
  'rawconfig',
  'subscriptionurl',
]);

const SECRET_KEY_SUBSTRINGS = ['password', 'secret', 'token', 'apikey'];

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (SECRET_KEY_NAMES.has(normalized)) return true;
  return SECRET_KEY_SUBSTRINGS.some((needle) => normalized.includes(needle));
}

export function sanitizeDiagnosticPayload<T>(value: T): T {
  if (typeof value === 'string') {
    return sanitizeSensitiveText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDiagnosticPayload(item)) as T;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, nestedValue]) =>
        isSecretKey(key)
          ? [key, REDACTED]
          : [key, sanitizeDiagnosticPayload(nestedValue)],
    );
    return Object.fromEntries(entries) as T;
  }
  return value;
}
