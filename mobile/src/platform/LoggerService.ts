import { UltimaCore } from '../native/UltimaCore';

const WRITE_DELAY_MS = 500;
const MAX_PENDING_CHARS = 512 * 1024;

/**
 * Same JSON-lines `app.log` as desktop, appended by the native side (which
 * also rotates it). Entries are batched: every write is a bridge round trip.
 */
export class LoggerService {
  private pending: string[] = [];
  private pendingChars = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly debugEnabled = import.meta.env.DEV;

  constructor(private readonly name: string = 'app') {}

  public getLogPath(): string {
    return `${this.name}.log`;
  }

  public log(location: string, message: string, data?: unknown): void {
    let entry: string;
    try {
      entry = `${JSON.stringify({
        timestamp: new Date().toISOString(),
        location,
        message,
        data,
      })}\n`;
    } catch {
      entry = `${JSON.stringify({
        timestamp: new Date().toISOString(),
        location,
        message,
      })}\n`;
    }
    if (this.debugEnabled) {
      console.debug(`[${location}] ${message}`, data ?? '');
    }
    this.pending.push(entry);
    this.pendingChars += entry.length;
    while (this.pendingChars > MAX_PENDING_CHARS && this.pending.length > 1) {
      this.pendingChars -= this.pending.shift()!.length;
    }
    this.timer ??= setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, WRITE_DELAY_MS);
  }

  public flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending.length > 0) {
      const text = this.pending.join('');
      this.pending = [];
      this.pendingChars = 0;
      this.writeQueue = this.writeQueue
        .then(() => UltimaCore.appendLog({ name: this.name, text }))
        .catch((error: unknown) => {
          console.error('Failed to write to log file', error);
        });
    }
    return this.writeQueue;
  }

  /** Rotation happens natively when the app starts. */
  public beginSession(): void {}

  public info(location: string, message: string, data?: unknown): void {
    this.log(location, `[INFO] ${message}`, data);
  }

  public warn(location: string, message: string, data?: unknown): void {
    this.log(location, `[WARN] ${message}`, data);
  }

  public error(location: string, message: string, error?: unknown): void {
    this.log(
      location,
      `[ERROR] ${message}`,
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : error,
    );
  }

  public debug(location: string, message: string, data?: unknown): void {
    if (!this.debugEnabled) return;
    this.log(location, `[DEBUG] ${message}`, data);
  }
}

export const logger = new LoggerService('app');
