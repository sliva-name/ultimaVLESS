// These patterns should only match errors that indicate the VLESS/XTLS tunnel itself is
// being interfered with at the protocol level — not individual request timeouts or resets
// that are normal for any proxy handling many connections.
const BLOCKING_ERROR_PATTERNS = [
  // Xray failed to establish the outbound connection to the remote server
  /failed to dial/i,
  // TLS/REALITY handshake rejected — strong signal of active blocking
  /handshake failure/i,
  /tls handshake/i,
  // Explicitly blocked or forbidden by a firewall/middlebox
  // Note: /blocked/i and /forbidden/i removed because they trigger false positives on HTTP 403
  // REALITY-specific: server rejected the connection
  /reality.*rejected/i,
  // Network-level: the remote is entirely unreachable
  /network unreachable/i,
  /no route to host/i,
];

export function isBlockingErrorText(text: string): boolean {
  return BLOCKING_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

export function extractBlockingErrors(lines: string[]): string[] {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && isBlockingErrorText(line));
}
