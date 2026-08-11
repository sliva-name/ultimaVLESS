// Strict types for Xray Configuration
// Based on Project X documentation

export type XrayLogConfig = {
  /** File path, or `'none'` to disable. Access logs record every destination. */
  access?: string;
  error?: string;
  loglevel: 'debug' | 'info' | 'warning' | 'error' | 'none';
  dnsLog?: boolean;
  /** IP redaction level applied by Xray itself. */
  maskAddress?: 'quarter' | 'half' | 'full';
};

export type XrayInbound = {
  tag?: string;
  port: number;
  listen?: string;
  protocol: string;
  settings?: Record<string, unknown>;
  streamSettings?: XrayStreamSettings | Record<string, unknown>;
  sniffing?: {
    enabled: boolean;
    destOverride: string[];
    metadataOnly?: boolean;
    routeOnly?: boolean;
  };
};

export type XrayOutbound = {
  tag?: string;
  sendThrough?: string;
  protocol: string;
  settings?: Record<string, unknown>;
  streamSettings?: XrayStreamSettings | Record<string, unknown>;
  mux?: XrayMuxSettings;
};

export type XrayKcpSettings = {
  mtu?: number;
  tti?: number;
  uplinkCapacity?: number;
  downlinkCapacity?: number;
  congestion?: boolean;
  readBufferSize?: number;
  writeBufferSize?: number;
  header?: { type: string; domain?: string };
};

export type XrayHttpObfsSettings = {
  path?: string;
  host?: string[];
};

export type XrayQuicSettings = {
  security?: string;
  key?: string;
  header?: { type: string; domain?: string };
};

export type XrayXhttpSettings = {
  path?: string;
  host?: string;
  mode?: string;
  extra?: Record<string, unknown>;
};

export type XrayMuxSettings = {
  enabled: boolean;
  concurrency?: number;
  xudpConcurrency?: number;
  xudpProxyUDP443?: string;
};

export type XrayTransportNetwork =
  | 'tcp'
  | 'raw'
  | 'kcp'
  | 'mkcp'
  | 'ws'
  | 'websocket'
  | 'http'
  | 'domainsocket'
  | 'quic'
  | 'grpc'
  | 'xhttp'
  | 'splithttp'
  | 'httpupgrade'
  | 'hysteria';

export type XrayHysteriaSettings = {
  version?: number;
  auth?: string;
  udpIdleTimeout?: number;
  masquerade?: Record<string, unknown>;
};

export type XrayStreamSettings = {
  /**
   * Canonical transport key in Project X docs (default `raw`).
   * Prefer this over `network` when generating configs.
   */
  method?: XrayTransportNetwork;
  /**
   * Legacy alias for `method` (`tcp` ↔ `raw`). Still accepted by Xray-core.
   */
  network?: XrayTransportNetwork;
  security: 'none' | 'tls' | 'reality';
  tlsSettings?: XrayTlsSettings;
  realitySettings?: XrayRealitySettings;
  wsSettings?: XrayWsSettings;
  httpupgradeSettings?: XrayHttpUpgradeSettings;
  grpcSettings?: XrayGrpcSettings;
  kcpSettings?: XrayKcpSettings;
  httpSettings?: XrayHttpObfsSettings;
  quicSettings?: XrayQuicSettings;
  xhttpSettings?: XrayXhttpSettings;
  hysteriaSettings?: XrayHysteriaSettings;
  tcpSettings?: XrayTcpSettings;
  /** Final traffic camouflage / QUIC params (opaque object). */
  finalmask?: Record<string, unknown>;
  sockopt?: {
    mark?: number;
    tcpFastOpen?: boolean;
    tproxy?: 'off' | 'tproxy' | 'redirect';
  };
};

export type XrayTlsSettings = {
  serverName?: string;
  allowInsecure?: boolean;
  pinnedPeerCertSha256?: string;
  verifyPeerCertByName?: string;
  verifyPeerCertInNames?: string[];
  alpn?: string[];
  certificates?: Array<Record<string, unknown>>;
  fingerprint?: string;
  /** Encrypted Client Hello config list (client). */
  echConfigList?: string;
};

export type XrayRealitySettings = {
  /** Server-only debug flag; omit on client outbounds. */
  show?: boolean;
  dest?: string;
  type?: string;
  xver?: number;
  serverNames?: string[];
  privateKey?: string;
  minClientVer?: string;
  maxClientVer?: string;
  maxTimeDiff?: number;
  shortIds?: string[];
  fingerprint?: string; // e.g. "chrome", "firefox", "safari"
  serverName?: string; // used in client outbound
  /** Client REALITY: x25519 **public** key (docs name this field `password`). */
  password?: string;
  /** Some configs use this name; Xray may accept it as alias — prefer `password` for clients. */
  publicKey?: string;
  shortId?: string; // used in client outbound
  spiderX?: string; // used in client outbound
  /** Post-quantum certificate verify key (client). */
  mldsa65Verify?: string;
};

export type XrayWsSettings = {
  path?: string;
  host?: string;
  headers?: Record<string, string>;
  heartbeatPeriod?: number;
};

export type XrayHttpUpgradeSettings = {
  path?: string;
  host?: string;
  headers?: Record<string, string>;
};

export type XrayGrpcSettings = {
  serviceName?: string;
  multiMode?: boolean;
};

export type XrayTcpSettings = {
  header?: {
    type: 'none' | 'http';
    request?: Record<string, unknown>;
    response?: Record<string, unknown>;
  };
};

export type XrayRoutingRule = {
  type: 'field';
  domain?: string[];
  ip?: string[];
  port?: string;
  network?: string;
  source?: string[];
  user?: string[];
  inboundTag?: string[];
  protocol?: string[];
  attrs?: string;
  outboundTag: string;
  balancerTag?: string;
};

export type XrayRouting = {
  domainStrategy: 'AsIs' | 'IPIfNonMatch' | 'IPOnDemand';
  rules: XrayRoutingRule[];
  balancers?: Array<Record<string, unknown>>;
};

export type XrayVersionConstraint = {
  min?: string;
  max?: string;
};

export type XrayConfig = {
  /** Process env map (raw passthrough only; UltimaVLESS does not inject). */
  env?: Record<string, string>;
  log?: XrayLogConfig;
  api?: Record<string, unknown>;
  dns?: Record<string, unknown>;
  routing?: XrayRouting;
  policy?: Record<string, unknown>;
  inbounds?: XrayInbound[];
  outbounds?: XrayOutbound[];
  stats?: Record<string, unknown>;
  reverse?: Record<string, unknown>;
  fakedns?: Record<string, unknown>;
  /** Minimum/maximum client core version allowed to run this config. */
  version?: XrayVersionConstraint;
};
