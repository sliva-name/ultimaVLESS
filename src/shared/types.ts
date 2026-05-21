export interface Subscription {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

import type { XrayConfig } from './xray-types';

export type ServerProtocol = 'vless' | 'trojan' | 'shadowsocks';

export type ServerTransport =
  | 'tcp'
  | 'raw'
  | 'kcp'
  | 'mkcp'
  | 'ws'
  | 'websocket'
  | 'grpc'
  | 'xhttp'
  | 'splithttp'
  | 'httpupgrade'
  /**
   * Legacy transports accepted by older Xray builds. The bundled Xray 26.3.27
   * rejects them; ConfigGenerator keeps them in the type only to surface a
   * precise error for persisted/imported servers.
   */
  | 'http'
  | 'quic';

export interface VlessConfig {
  uuid: string;
  userId?: string; // original VLESS user UUID used for auth
  address: string;
  port: number;
  name: string;
  source?: 'subscription' | 'manual';
  subscriptionId?: string; // which Subscription this server came from
  /**
   * Outbound protocol for this server. Defaults to 'vless' when absent for
   * backwards compatibility.
   */
  protocol?: ServerProtocol;
  /** Trojan/Shadowsocks password. */
  password?: string;
  /** Shadowsocks cipher method (only used when protocol === 'shadowsocks'). */
  method?: string;
  /** Allow self-signed / mismatched TLS certificates (from link params). */
  allowInsecure?: boolean;
  /** Xray 26.3.27 replacement for allowInsecure-style certificate pinning. */
  pinnedPeerCertSha256?: string;
  /** Xray 26.3.27 certificate name override. */
  verifyPeerCertByName?: string;
  flow?: string; // xtls-rprx-vision
  encryption?: string;
  type?: ServerTransport;
  security?: 'reality' | 'tls' | 'none';
  sni?: string;
  fp?: string; // chrome, firefox, safari, etc.
  pbk?: string; // reality public key
  sid?: string; // reality short id
  spx?: string; // reality spiderX

  // WS specific
  path?: string;
  host?: string;
  wsMaxEarlyData?: number;

  // XHTTP specific
  mode?: string;
  xhttpExtra?: Record<string, unknown>;
  noGRPCHeader?: boolean;

  // gRPC specific
  serviceName?: string;

  // Ping information
  ping?: number | null;
  pingTime?: number;
  /**
   * True when the latency is the last known value carried through a refresh,
   * but has not been confirmed by a safe idle-state ping yet.
   */
  pingStale?: boolean;

  // Full Xray config from JSON subscription
  rawConfig?: XrayConfig;
}

export type ConnectionMode = 'proxy' | 'tun';

export type XudpProxyUDP443 = 'reject' | 'allow' | 'skip';
export type LogLevel = 'debug' | 'info' | 'warning' | 'error' | 'none';
export type DomainStrategy = 'AsIs' | 'IPIfNonMatch' | 'IPOnDemand';
export type TlsFingerprint =
  | 'chrome'
  | 'firefox'
  | 'safari'
  | 'edge'
  | 'random'
  | 'randomized';

export const VALID_XUDP_PROXY_UDP_443_VALUES: readonly XudpProxyUDP443[] = [
  'reject',
  'allow',
  'skip',
] as const;
export const VALID_LOG_LEVELS: readonly LogLevel[] = [
  'debug',
  'info',
  'warning',
  'error',
  'none',
] as const;
export const VALID_DOMAIN_STRATEGIES: readonly DomainStrategy[] = [
  'AsIs',
  'IPIfNonMatch',
  'IPOnDemand',
] as const;
export const VALID_TLS_FINGERPRINTS: readonly TlsFingerprint[] = [
  'chrome',
  'firefox',
  'safari',
  'edge',
  'random',
  'randomized',
] as const;

export interface PerformanceSettings {
  muxEnabled: boolean;
  muxConcurrency: number;
  xudpConcurrency: number;
  xudpProxyUDP443: XudpProxyUDP443;
  tcpFastOpen: boolean;
  sniffingRouteOnly: boolean;
  logLevel: LogLevel;
  fingerprint: TlsFingerprint;
  blockAds: boolean;
  blockBittorrent: boolean;
  domainStrategy: DomainStrategy;
}

export const DEFAULT_PERFORMANCE_SETTINGS: PerformanceSettings = {
  muxEnabled: false,
  muxConcurrency: 8,
  xudpConcurrency: 16,
  xudpProxyUDP443: 'reject',
  tcpFastOpen: true,
  sniffingRouteOnly: true,
  logLevel: 'warning',
  fingerprint: 'chrome',
  blockAds: false,
  blockBittorrent: false,
  domainStrategy: 'AsIs',
};
