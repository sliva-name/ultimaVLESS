import { EventEmitter } from './events';
import { UltimaCore } from '../native/UltimaCore';

interface TlsConnectOptions {
  host?: string;
  port: number;
  servername?: string;
}

/**
 * A TLS socket that only completes the handshake (`secureConnect`) and is
 * then destroyed: the ping's TLS check. Certificates are not verified,
 * matching the `rejectUnauthorized: false` the caller passes.
 */
class TlsProbeSocket extends EventEmitter {
  private timeoutMs = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  destroyed = false;

  constructor(options: TlsConnectOptions) {
    super();
    queueMicrotask(() => this.start(options));
  }

  setTimeout(ms: number): this {
    this.timeoutMs = ms;
    return this;
  }

  private start(options: TlsConnectOptions): void {
    if (this.destroyed) return;
    if (this.timeoutMs > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        if (!this.destroyed) this.emit('timeout');
      }, this.timeoutMs);
    }
    UltimaCore.tlsHandshake({
      host: options.host ?? '127.0.0.1',
      port: options.port,
      sni: options.servername ?? '',
      timeoutMs: this.timeoutMs > 0 ? this.timeoutMs + 1000 : 30_000,
    }).then(
      (result) => {
        if (this.destroyed) return;
        this.clearTimer();
        if (result.ok) this.emit('secureConnect');
        else this.emit('error', new Error(result.error ?? 'TLS failed'));
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
    queueMicrotask(() => this.emit('close', false));
    return this;
  }
}

export function connect(options: TlsConnectOptions): TlsProbeSocket {
  return new TlsProbeSocket(options);
}

export type ConnectionOptions = TlsConnectOptions & Record<string, unknown>;

export default { connect };
