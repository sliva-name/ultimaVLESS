const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const IPV4_PATTERN = /\b(?<!127\.0\.0\.1)(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g;

export function sanitizeSensitiveText(text: string): string {
  return text
    .replace(UUID_PATTERN, '***-UUID-***')
    .replace(IPV4_PATTERN, '***.***.***.***');
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
