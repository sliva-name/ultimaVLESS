/**
 * Keeps only what identifies the endpoint for troubleshooting. The path is
 * dropped as well as the query: subscription links routinely carry the access
 * token as a path segment (`/sub/<token>`), and userinfo carries credentials.
 */
export function redactUrl(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : '/…';
    return `${parsed.protocol}//${parsed.host}${path}`;
  } catch {
    return '[invalid-url]';
  }
}
