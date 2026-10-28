import React from 'react';
import clsx from 'clsx';
import { Clock, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { VlessConfig } from '@/shared/types';
import { CountryFlag, hasCountryFlag } from '@/renderer/components/CountryFlag';
import {
  SUBSCRIPTION_COLORS,
  getSubscriptionColor,
} from '@/renderer/components/sidebarModel';

/** A subscription's color slot, the same one the desktop sidebar uses. */
export function subscriptionColorIndex(subscriptionId: string): number {
  return Math.max(
    0,
    SUBSCRIPTION_COLORS.indexOf(getSubscriptionColor(subscriptionId)),
  );
}

const PROTOCOL_NAMES: Record<string, string> = {
  vless: 'VLESS',
  vmess: 'VMess',
  trojan: 'Trojan',
  shadowsocks: 'Shadowsocks',
  hysteria: 'Hysteria',
  wireguard: 'WireGuard',
};

const TRANSPORT_NAMES: Record<string, string> = {
  ws: 'WS',
  websocket: 'WS',
  grpc: 'gRPC',
  xhttp: 'XHTTP',
  splithttp: 'XHTTP',
  httpupgrade: 'HTTPUpgrade',
  kcp: 'mKCP',
  mkcp: 'mKCP',
  quic: 'QUIC',
  http: 'HTTP/2',
  h2: 'HTTP/2',
};

/** "VLESS · REALITY", "Trojan · TLS", "VLESS · XHTTP", "Shadowsocks". */
export function describeServer(
  server: Pick<VlessConfig, 'protocol' | 'type' | 'security'>,
): string {
  const protocol = server.protocol ?? 'vless';
  const name = PROTOCOL_NAMES[protocol] ?? String(protocol).toUpperCase();
  if (
    protocol === 'shadowsocks' ||
    protocol === 'hysteria' ||
    protocol === 'wireguard'
  ) {
    return name;
  }
  const transport = server.type ? TRANSPORT_NAMES[server.type] : undefined;
  const detail =
    transport ??
    (server.security === 'reality'
      ? 'REALITY'
      : server.security === 'tls'
        ? 'TLS'
        : 'TCP');
  return `${name} · ${detail}`;
}

/** Badge colors: < 100 green, < 200 yellow, < 300 orange, else red. */
function latencyClass(ping: number): string {
  if (ping < 100) return 'bg-lat1-soft text-lat1';
  if (ping < 200) return 'bg-lat2-soft text-lat2';
  if (ping < 300) return 'bg-lat3-soft text-lat3';
  return 'bg-lat4-soft text-lat4';
}

interface PingBadgeProps {
  server: Pick<VlessConfig, 'ping' | 'pingStale'>;
  /** Waiting for this server's answer in the running check. */
  pending?: boolean;
}

/** Gray when there is no answer or the measurement is stale. */
export const PingBadge: React.FC<PingBadgeProps> = ({ server, pending }) => {
  const { t } = useTranslation();
  const { ping, pingStale } = server;
  const fresh = !pending && ping != null && !pingStale;
  return (
    <span
      className={clsx(
        'shrink-0 min-w-16 h-7 px-2.5 inline-flex items-center justify-center gap-1 rounded-lg text-[13px] leading-4 font-semibold tabular-nums whitespace-nowrap',
        fresh ? latencyClass(ping) : 'bg-s3 text-fg3',
      )}
    >
      {pending ? (
        '···'
      ) : ping == null ? (
        '—'
      ) : (
        <>
          {pingStale && (
            <Clock className="w-[13px] h-[13px]" strokeWidth={2} aria-hidden />
          )}
          {ping} {t('sidebar.ms')}
        </>
      )}
    </span>
  );
};

/** Country flag cropped to a circle; a globe when the country is unknown. */
export const ServerFlag: React.FC<{
  server: { name: string; address: string };
  size: number;
}> = ({ server, size }) => (
  <span
    aria-hidden="true"
    className="relative shrink-0 rounded-full overflow-hidden flex items-center justify-center bg-s3 text-fg3"
    style={{ width: size, height: size }}
  >
    {hasCountryFlag(server) ? (
      <CountryFlag
        server={server}
        size={Math.round((size * 3) / 2)}
        className="max-w-none"
      />
    ) : (
      <Globe
        style={{ width: size * 0.6, height: size * 0.6 }}
        strokeWidth={1.75}
      />
    )}
    <span className="absolute inset-0 rounded-full shadow-[inset_0_0_0_1px_var(--color-flag-ring)]" />
  </span>
);
