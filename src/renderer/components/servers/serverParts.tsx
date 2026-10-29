import React from 'react';
import clsx from 'clsx';
import { Clock, Globe, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { VlessConfig } from '@/shared/types';
import { CountryFlag, hasCountryFlag } from '@/renderer/components/CountryFlag';

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

/** The transport alone, for the details list: "XHTTP", "gRPC", "TCP". */
export function describeTransport(
  server: Pick<VlessConfig, 'type' | 'security'>,
): string {
  const transport = server.type ? TRANSPORT_NAMES[server.type] : undefined;
  return transport ?? (server.type ? server.type.toUpperCase() : 'TCP');
}

/** Badge colors: < 100 green, < 200 yellow, < 300 orange, else red. */
export function latencyClass(ping: number): string {
  if (ping < 100) return 'bg-lat1-soft text-lat1';
  if (ping < 200) return 'bg-lat2-soft text-lat2';
  if (ping < 300) return 'bg-lat3-soft text-lat3';
  return 'bg-lat4-soft text-lat4';
}

interface PingBadgeProps {
  server: Pick<VlessConfig, 'ping' | 'pingStale'>;
  /** Waiting for this server's answer in the running check. */
  pending?: boolean;
  /** 28 px chip on the stage instead of the 22 px row badge. */
  large?: boolean;
}

/** Gray when there is no answer or the measurement is stale. */
export const PingBadge: React.FC<PingBadgeProps> = ({
  server,
  pending,
  large,
}) => {
  const { t } = useTranslation();
  const { ping, pingStale } = server;
  const fresh = !pending && ping != null && !pingStale;
  return (
    <span
      className={clsx(
        'shrink-0 box-border inline-flex items-center justify-center gap-1 text-xs leading-4 font-semibold tabular-nums whitespace-nowrap',
        large
          ? 'h-7 px-2.5 rounded-lg'
          : 'min-w-[60px] h-[22px] px-2 rounded-md',
        pending
          ? 'bg-acc-soft text-acc-nav'
          : fresh
            ? latencyClass(ping)
            : 'bg-s3 text-fg3',
      )}
    >
      {pending ? (
        <>
          <Loader2
            aria-hidden
            strokeWidth={2.5}
            className="w-3 h-3 animate-spin motion-reduce:animate-none"
          />
          {t('servers.measuring')}
        </>
      ) : ping == null ? (
        large ? (
          t('home.noAnswer')
        ) : (
          '—'
        )
      ) : (
        <>
          {pingStale && (
            <Clock aria-hidden strokeWidth={2} className="w-3 h-3" />
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
