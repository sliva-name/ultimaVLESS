const BLOCKING_ERROR_PATTERNS = [
  /failed to dial/i,
  /connection refused/i,
  /connection reset/i,
  /timeout/i,
  /i\/o timeout/i,
  /network unreachable/i,
  /no route to host/i,
  /connection closed/i,
  /handshake failure/i,
  /blocked/i,
  /forbidden/i,
  /context deadline exceeded/i,
];

export function isBlockingErrorText(text: string): boolean {
  return BLOCKING_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

export function extractBlockingErrors(lines: string[]): string[] {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && isBlockingErrorText(line));
}
