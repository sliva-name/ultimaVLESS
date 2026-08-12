export interface Subscription {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

import type { XrayConfig } from './xray-types';

export type ServerProtocol =
  | 'vless'
  | 'vmess'
  | 'trojan'
  | 'shadowsocks'
  | 'hysteria'
  | 'wireguard';

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
  | 'hysteria'
  /**
   * Legacy transports. Bundled Xray rejects them; the compiler keeps them in the
   * type only to surface a precise error for persisted/imported servers.
   */
  | 'http'
  | 'quic';

export type WireGuardPeer = {
  endpoint: string;
  publicKey: string;
  preSharedKey?: string;
  keepAlive?: number;
  allowedIPs?: string[];
};

export interface ServerConfig {
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
  /** Trojan/Shadowsocks/Hysteria auth password. */
  password?: string;
  /** Shadowsocks cipher method (only used when protocol === 'shadowsocks'). */
  method?: string;
  /** Allow self-signed / mismatched TLS certificates (from link params). */
  allowInsecure?: boolean;
  /** Certificate pinning (replaces allowInsecure-style trust). */
  pinnedPeerCertSha256?: string;
  /** TLS certificate name override. */
  verifyPeerCertByName?: string;
  /** TLS Encrypted Client Hello config list (client). */
  echConfigList?: string;
  /**
   * VMess security when protocol === 'vmess'.
   * `none` / `zero` are accepted from older links and coerced to `auto`
   * (removed in Xray 26.7+).
   */
  vmessSecurity?: 'aes-128-gcm' | 'chacha20-poly1305' | 'auto' | 'none' | 'zero';
  flow?: string; // xtls-rprx-vision
  encryption?: string;
  type?: ServerTransport;
  security?: 'reality' | 'tls' | 'none';
  sni?: string;
  fp?: string; // chrome, firefox, safari, etc.
  pbk?: string; // reality public key
  sid?: string; // reality short id
  spx?: string; // reality spiderX
  /** REALITY post-quantum certificate verify key (client). */
  mldsa65Verify?: string;
  /** Opaque streamSettings.finalmask passthrough / emit. */
  finalmask?: Record<string, unknown>;

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

  // Hysteria2
  hysteriaAuth?: string;
  hysteriaObfs?: { type?: string; password?: string };

  // WireGuard
  wgSecretKey?: string;
  wgAddress?: string[];
  wgPeers?: WireGuardPeer[];
  wgMtu?: number;
  wgReserved?: number[];
  wgNoKernelTun?: boolean;
  wgDomainStrategy?: string;

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

export type VlessConfig = ServerConfig;

export type ConnectionMode = 'proxy' | 'tun';

export type XudpProxyUDP443 = 'reject' | 'allow' | 'skip';
export type LogLevel = 'debug' | 'info' | 'warning' | 'error' | 'none';
export type DomainStrategy = 'AsIs' | 'IPIfNonMatch' | 'IPOnDemand';
export type TlsFingerprint =
  | 'chrome'
  | 'firefox'
  | 'safari'
  | 'ios'
  | 'android'
  | 'edge'
  | '360'
  | 'qq'
  | 'random'
  | 'randomized';

/** Windows-only: who installs TUN routes — Xray 26.5+ or legacy PowerShell. */
export type WindowsTunRouting = 'xray' | 'powershell';

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
  'ios',
  'android',
  'edge',
  '360',
  'qq',
  'random',
  'randomized',
] as const;

export type RemoteDnsPreset = 'cloudflare' | 'google' | 'quad9' | 'custom';
export const VALID_REMOTE_DNS_PRESETS: readonly RemoteDnsPreset[] = [
  'cloudflare',
  'google',
  'quad9',
  'custom',
] as const;

export const REMOTE_DNS_PRESET_SERVERS: Record<
  Exclude<RemoteDnsPreset, 'custom'>,
  readonly [string, string]
> = {
  cloudflare: ['1.1.1.1', '1.0.0.1'],
  google: ['8.8.8.8', '8.8.4.4'],
  quad9: ['9.9.9.9', '149.112.112.112'],
};

export interface PerformanceSettings {
  muxEnabled: boolean;
  muxConcurrency: number;
  xudpConcurrency: number;
  xudpProxyUDP443: XudpProxyUDP443;
  /**
   * XHTTP `extra.xmux.maxConnections`. Matches Xray 26.7.28+ default (3).
   * Raise toward 6 if a server feels connection-starved; keep low for anti-TSPU.
   */
  xhttpMaxConnections: number;
  /** Remote DNS preset for Xray dns.servers / TUN OS DNS (no localhost). */
  remoteDnsPreset: RemoteDnsPreset;
  /** 1–2 IPv4 resolvers; filled from preset unless custom. */
  remoteDnsServers: string[];
  tcpFastOpen: boolean;
  sniffingRouteOnly: boolean;
  logLevel: LogLevel;
  fingerprint: TlsFingerprint;
  blockAds: boolean;
  blockBittorrent: boolean;
  domainStrategy: DomainStrategy;
  /** Windows TUN only. Default `xray` for testing; use `powershell` to roll back. */
  windowsTunRouting: WindowsTunRouting;
  /**
   * Split tunneling: hosts that leave through the physical interface instead of
   * the tunnel. Bare hosts cover subdomains; `full:`/`keyword:`/`geosite:`
   * matchers are stored verbatim.
   */
  bypassDomains: string[];
  /** Split tunneling by address: IPs, CIDR blocks, or `geoip:` tags. */
  bypassIps: string[];
}

export const DEFAULT_PERFORMANCE_SETTINGS: PerformanceSettings = {
  muxEnabled: false,
  muxConcurrency: 8,
  xudpConcurrency: 16,
  xudpProxyUDP443: 'reject',
  xhttpMaxConnections: 3,
  remoteDnsPreset: 'cloudflare',
  remoteDnsServers: [...REMOTE_DNS_PRESET_SERVERS.cloudflare],
  tcpFastOpen: true,
  sniffingRouteOnly: true,
  logLevel: 'warning',
  fingerprint: 'chrome',
  blockAds: false,
  blockBittorrent: false,
  domainStrategy: 'AsIs',
  windowsTunRouting: 'xray',
  // VK blocks or throttles traffic from many VPN exit IPs, so it is excluded
  // out of the box; users can drop it in the network settings.
  bypassDomains: ['vk.com'],
  bypassIps: [],
};
