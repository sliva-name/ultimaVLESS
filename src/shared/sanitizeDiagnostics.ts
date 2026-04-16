const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const IPV4_PATTERN = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g;

/** IPs we deliberately keep as-is because they never reveal private identity. */
const PRESERVED_IPS = new Set([
  '127.0.0.1',
  '0.0.0.0',
  '255.255.255.255',
]);

function redactIpv4(match: string): string {
  if (PRESERVED_IPS.has(match)) return match;
  // Private CIDR ranges, loopback, link-local — safe to preserve in diagnostics.
  const octets = match.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
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

export function sanitizeSensitiveText(text: string): string {
  return text
    .replace(UUID_PATTERN, '***-UUID-***')
    .replace(IPV4_PATTERN, redactIpv4);
}

export function sanitizeDiagnosticPayload<T>(value: T): T {
  if (typeof value === 'string') {
    return sanitizeSensitiveText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDiagnosticPayload(item)) as T;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
      key,
      sanitizeDiagnosticPayload(nestedValue),
    ]);
    return Object.fromEntries(entries) as T;
  }
  return value;
}
