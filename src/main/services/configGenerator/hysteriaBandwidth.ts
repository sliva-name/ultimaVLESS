import { isBrutalMbps } from '@/shared/hysteriaBandwidth';
import type { PerformanceSettings, VlessConfig } from '@/shared/types';

/** Where a declared speed can come from, in the order they win. */
export type HysteriaRateSource = Pick<
  VlessConfig | PerformanceSettings,
  'hysteriaUpMbps' | 'hysteriaDownMbps'
>;

/**
 * Declares the client's link speed to a Hysteria server in
 * `finalmask.quicParams`. `brutalDown` lets a server whose own `brutalUp` is
 * set send with Brutal at `min(its brutalUp, brutalDown)`; `brutalUp` does
 * the same for the client's uploads. Without them both sides keep BBR.
 *
 * Each direction is taken on its own: a rate already in the link's own `fm`
 * wins, then the first source with a rate Xray accepts (the link's
 * `upmbps`/`downmbps`, then this device's setting). Other quicParams stay as
 * they are.
 * @see https://github.com/XTLS/Xray-core/blob/main/transport/internet/hysteria/hub.go
 */
export function withHysteriaBandwidth(
  finalmask: Record<string, unknown> | undefined,
  ...sources: (HysteriaRateSource | undefined)[]
): Record<string, unknown> | undefined {
  const rates: [string, number][] = [];
  for (const [param, key] of [
    ['brutalUp', 'hysteriaUpMbps'],
    ['brutalDown', 'hysteriaDownMbps'],
  ] as const) {
    const mbps = sources.map((source) => source?.[key]).find(isBrutalMbps);
    if (mbps !== undefined) rates.push([param, mbps]);
  }
  if (rates.length === 0) return finalmask;

  const next = finalmask ?? {};
  const current = next.quicParams;
  // Not ours to fix: Xray reports a malformed quicParams itself.
  if (
    current !== undefined &&
    current !== null &&
    (typeof current !== 'object' || Array.isArray(current))
  ) {
    return next;
  }
  // A copy: the caller's finalmask may share it with the stored server.
  const quicParams = { ...(current ?? {}) } as Record<string, unknown>;
  for (const [key, mbps] of rates) {
    quicParams[key] ??= `${mbps} mbps`;
  }
  next.quicParams = quicParams;
  return next;
}
