/**
 * Xray refuses a Brutal rate under 65536 bytes/s. Its `Bandwidth` counts
 * `mbps` in powers of 1024 bits, so that is 0.5 mbps.
 * @see https://github.com/XTLS/Xray-core/blob/main/infra/conf/transport_method.go (`Bandwidth.Bps`)
 */
export const MIN_BRUTAL_MBPS = 0.5;
/** 1 tbps: anything above is a typo, not a link speed. */
export const MAX_BRUTAL_MBPS = 1024 * 1024;

/** A link speed Xray accepts as a Brutal rate, in Mbit/s. */
export function isBrutalMbps(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_BRUTAL_MBPS &&
    value <= MAX_BRUTAL_MBPS
  );
}

/** A stored speed setting: a rate Xray accepts, or 0 ("not set"). */
export function normalizeHysteriaMbps(value: unknown): number {
  return isBrutalMbps(value) ? value : 0;
}

/**
 * A speed typed into a settings field: empty or 0 is 0 ("not set"), anything
 * else is clamped into the range Xray accepts. A comma counts as the decimal
 * point. `null` when the text is not a number.
 */
export function readMbpsInput(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return 0;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  if (value <= 0) return 0;
  return Math.min(MAX_BRUTAL_MBPS, Math.max(MIN_BRUTAL_MBPS, value));
}
