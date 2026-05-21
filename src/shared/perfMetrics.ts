/**
 * Lightweight timing helpers for startup and hot-path diagnostics.
 * Logs only when `ULTIMA_DEBUG=1` or NODE_ENV=development (main) /
 * import.meta.env.DEV (renderer).
 */

export function isPerfLoggingEnabled(): boolean {
  if (typeof process !== 'undefined' && process.env) {
    return (
      process.env.NODE_ENV === 'development' ||
      process.env.ULTIMA_DEBUG === '1'
    );
  }
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

export class PerfTimer {
  private readonly originMs =
    typeof performance !== 'undefined' ? performance.now() : Date.now();

  constructor(
    private readonly scope: string,
    private readonly label: string,
  ) {}

  public elapsedMs(): number {
    const now =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    return Math.round(now - this.originMs);
  }

  public end(extra?: Record<string, unknown>): number {
    const durationMs = this.elapsedMs();
    if (isPerfLoggingEnabled()) {
      console.debug(`[Perf] ${this.scope} ${this.label}`, {
        durationMs,
        ...extra,
      });
    }
    return durationMs;
  }
}

export function perfMark(
  scope: string,
  label: string,
  extra?: Record<string, unknown>,
): void {
  if (!isPerfLoggingEnabled()) return;
  console.debug(`[Perf] ${scope} ${label}`, extra ?? {});
}
