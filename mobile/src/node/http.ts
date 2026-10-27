import { EventEmitter } from './events';
import { UltimaCore } from '../native/UltimaCore';

interface RequestOptions {
  host?: string;
  hostname?: string;
  port?: number;
  path?: string;
  method?: string;
  headers?: Record<string, string>;
  agent?: unknown;
}

/** The response the probes read: status and headers, body discarded. */
class IncomingMessage extends EventEmitter {
  constructor(
    readonly statusCode: number,
    readonly headers: Record<string, string>,
  ) {
    super();
  }

  resume(): this {
    queueMicrotask(() => this.emit('end'));
    return this;
  }

  setEncoding(): this {
    return this;
  }
}

/** Header keys the platform HTTP stack sets on its own. */
const NATIVE_MANAGED_HEADERS = new Set(['host', 'connection']);

/**
 * Plain-HTTP GETs of the health and delay probes. A `path` holding an
 * absolute URL is a request through the HTTP proxy at `host:port` (Xray's
 * local `http` inbound); anything else goes straight to `host:port`.
 */
class ClientRequest extends EventEmitter {
  private timeoutMs = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  destroyed = false;

  constructor(private readonly options: RequestOptions) {
    super();
  }

  setTimeout(ms: number, callback?: () => void): this {
    this.timeoutMs = ms;
    if (callback) this.once('timeout', callback);
    return this;
  }

  end(): this {
    queueMicrotask(() => this.send());
    return this;
  }

  private send(): void {
    if (this.destroyed) return;
    const host = this.options.hostname ?? this.options.host ?? 'localhost';
    const port = this.options.port ?? 80;
    const path = this.options.path ?? '/';
    const throughProxy = /^https?:\/\//i.test(path);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.options.headers ?? {})) {
      if (!NATIVE_MANAGED_HEADERS.has(key.toLowerCase())) headers[key] = value;
    }

    if (this.timeoutMs > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        if (!this.destroyed) this.emit('timeout');
      }, this.timeoutMs);
    }

    UltimaCore.httpRequest({
      url: throughProxy ? path : `http://${host}:${port}${path}`,
      method: this.options.method ?? 'GET',
      headers,
      timeoutMs: this.timeoutMs > 0 ? this.timeoutMs + 1000 : 30_000,
      proxyPort: throughProxy ? port : undefined,
      followRedirects: false,
      maxBodyBytes: 0,
    }).then(
      (response) => {
        if (this.destroyed) return;
        this.clearTimer();
        this.emit(
          'response',
          new IncomingMessage(response.status, response.headers),
        );
      },
      (error: unknown) => {
        if (this.destroyed) return;
        this.clearTimer();
        this.emit(
          'error',
          error instanceof Error ? error : new Error(String(error)),
        );
      },
    );
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  destroy(): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.clearTimer();
    queueMicrotask(() => this.emit('close'));
    return this;
  }
}

export function request(options: RequestOptions): ClientRequest {
  return new ClientRequest(options);
}

export default { request };
