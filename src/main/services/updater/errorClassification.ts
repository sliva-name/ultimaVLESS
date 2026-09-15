const TRANSIENT_NETWORK_PATTERNS = [
  /ERR_ADDRESS_UNREACHABLE/i,
  /ERR_INTERNET_DISCONNECTED/i,
  /ERR_NAME_NOT_RESOLVED/i,
  /ERR_NETWORK_CHANGED/i,
  /ERR_PROXY_CONNECTION_FAILED/i,
  /ERR_CONNECTION_RESET/i,
  /ERR_CONNECTION_REFUSED/i,
  /ERR_CONNECTION_TIMED_OUT/i,
  /\bENETUNREACH\b/,
  /\bENOTFOUND\b/,
  /\bETIMEDOUT\b/,
  /\bECONNRESET\b/,
  /\bECONNREFUSED\b/,
  /\bEHOSTUNREACH\b/,
  /\bEAI_AGAIN\b/,
  /getaddrinfo/i,
  /network is unreachable/i,
];

/**
 * GitHub already published the tag/latest.yml, but the installer asset is
 * still being built. electron-updater then 404s with a huge URL dump that
 * must not take over the UI.
 */
const INCOMPLETE_RELEASE_PATTERNS = [
  /HttpError:\s*4\d\d/i,
  /statusCode:\s*4\d\d/i,
  /status code 4\d\d/i,
  /\b404\b[^a-z0-9]*Not Found/i,
  /Not Found[^a-z0-9]*\b404\b/i,
  /Cannot download/i,
  /ERR_FAILED/i,
  /latest\.yml/i,
];

export function isIncompleteReleaseError(message: string): boolean {
  return INCOMPLETE_RELEASE_PATTERNS.some((pattern) => pattern.test(message));
}

export function isTransientUpdateError(message: string): boolean {
  return (
    TRANSIENT_NETWORK_PATTERNS.some((pattern) => pattern.test(message)) ||
    isIncompleteReleaseError(message)
  );
}

export function clipUpdateErrorMessage(
  message: string,
  maxLength = 280,
): string {
  const collapsed = message.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  return `${collapsed.slice(0, Math.max(0, maxLength - 1))}…`;
}
