import { UltimaCore } from '../native/UltimaCore';

/** Larger than the subscription service's own 5 MB body limit. */
const MAX_BODY_BYTES = 6_000_000;
const REQUEST_TIMEOUT_MS = 60_000;
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

function headerRecord(init: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function abortError(): DOMException {
  return new DOMException('This operation was aborted', 'AbortError');
}

/**
 * Sends the backend's cross-origin `fetch` calls (subscriptions) through the
 * native HTTP stack: the WebView's own would apply CORS, follow redirects the
 * subscription service validates hop by hop (`redirect: 'manual'`), and refuse
 * the browser-like `User-Agent` some mirrors need. Failures surface like
 * Node's fetch: a `TypeError` with the error code in `cause`.
 */
export function installNativeFetch(): void {
  const original = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : null;
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    let url: URL;
    try {
      url = new URL(rawUrl, location.href);
    } catch {
      return original(input, init);
    }
    if (
      url.origin === location.origin ||
      (url.protocol !== 'http:' && url.protocol !== 'https:')
    ) {
      return original(input, init);
    }

    const signal = init?.signal ?? request?.signal ?? null;
    if (signal?.aborted) throw abortError();

    const pending = UltimaCore.httpRequest({
      url: url.href,
      method: init?.method ?? request?.method ?? 'GET',
      headers: headerRecord(init?.headers ?? request?.headers),
      timeoutMs: REQUEST_TIMEOUT_MS,
      followRedirects: (init?.redirect ?? request?.redirect) !== 'manual',
      maxBodyBytes: MAX_BODY_BYTES,
    });

    const result = await new Promise<Awaited<typeof pending>>(
      (resolve, reject) => {
        const onAbort = () => reject(abortError());
        signal?.addEventListener('abort', onAbort, { once: true });
        pending.then(
          (value) => {
            signal?.removeEventListener('abort', onAbort);
            resolve(value);
          },
          (error: unknown) => {
            signal?.removeEventListener('abort', onAbort);
            const code =
              (error as { code?: unknown } | null)?.code ?? 'ENETWORK';
            reject(
              new TypeError('fetch failed', {
                cause: {
                  code: typeof code === 'string' ? code : 'ENETWORK',
                  message: error instanceof Error ? error.message : '',
                },
              }),
            );
          },
        );
      },
    );

    return new Response(
      NULL_BODY_STATUSES.has(result.status) ? null : result.body,
      { status: result.status, headers: result.headers },
    );
  };
}
