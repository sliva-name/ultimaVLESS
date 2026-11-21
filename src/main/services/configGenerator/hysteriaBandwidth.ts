import type { VlessConfig } from '@/shared/types';

/**
 * Xray refuses a Brutal rate under 65536 bytes/s. Its `Bandwidth` counts
 * `mbps` in powers of 1024 bits, so that is 0.5 mbps.
 * @see https://github.com/XTLS/Xray-core/blob/main/infra/conf/transport_method.go (`Bandwidth.Bps`)
 */
const MIN_BRUTAL_MBPS = 0.5;
/** 1 tbps: anything above is a typo, not a link. */
const MAX_BRUTAL_MBPS = 1024 * 1024;

/** A link speed Xray accepts as a Brutal rate, in Mbit/s. */
export function isBrutalMbps(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_BRUTAL_MBPS &&
    value <= MAX_BRUTAL_MBPS
  );
}

/**
 * Declares the client's link speed to a Hysteria server in
 * `finalmask.quicParams`. `brutalDown` lets a server whose own `brutalUp` is
 * set send with Brutal at `min(its brutalUp, brutalDown)`; `brutalUp` does
 * the same for the client's uploads. Without them both sides keep BBR.
 * Rates already in the link's own `fm` win; other quicParams stay as they are.
 * @see https://github.com/XTLS/Xray-core/blob/main/transport/internet/hysteria/hub.go
 */
export function withHysteriaBandwidth(
  finalmask: Record<string, unknown> | undefined,
  config: Pick<VlessConfig, 'hysteriaUpMbps' | 'hysteriaDownMbps'>,
): Record<string, unknown> | undefined {
  const rates = (
    [
      ['brutalUp', config.hysteriaUpMbps],
      ['brutalDown', config.hysteriaDownMbps],
    ] as const
  ).filter(([, mbps]) => isBrutalMbps(mbps));
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
