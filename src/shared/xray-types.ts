// Strict types for Xray Configuration
// Based on Project X documentation

export type XrayLogConfig = {
  access?: string;
  error?: string;
  loglevel: 'debug' | 'info' | 'warning' | 'error' | 'none';
  dnsLog?: boolean;
};

export type XrayInbound = {
  tag?: string;
  port: number;
  listen?: string;
  protocol: 'socks' | 'http' | 'dokodemo-door' | 'vless' | 'vmess' | 'trojan' | 'shadowsocks';
  settings?: any;
  streamSettings?: XrayStreamSettings;
  sniffing?: {
    enabled: boolean;
    destOverride: string[];
    metadataOnly?: boolean;
  };
};

export type XrayOutbound = {
  tag?: string;
  sendThrough?: string;
  protocol: 'freedom' | 'blackhole' | 'vless' | 'vmess' | 'trojan' | 'shadowsocks' | 'dns';
  settings?: any;
  streamSettings?: XrayStreamSettings;
  mux?: {
    enabled: boolean;
    concurrency?: number;
  };
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

export type XrayMuxSettings = {
  enabled: boolean;
  concurrency?: number;
  xudpConcurrency?: number;
  xudpProxyUDP443?: string;
};

export type XrayStreamSettings = {
  network: 'tcp' | 'raw' | 'kcp' | 'ws' | 'http' | 'domainsocket' | 'quic' | 'grpc';
  security: 'none' | 'tls' | 'reality';
  tlsSettings?: XrayTlsSettings;
  realitySettings?: XrayRealitySettings;
  wsSettings?: XrayWsSettings;
  grpcSettings?: XrayGrpcSettings;
  kcpSettings?: XrayKcpSettings;
  httpSettings?: XrayHttpObfsSettings;
  quicSettings?: XrayQuicSettings;
  tcpSettings?: XrayTcpSettings;
  mux?: XrayMuxSettings;
  sockopt?: {
    mark?: number;
    tcpFastOpen?: boolean;
    tproxy?: 'off' | 'tproxy' | 'redirect';
  };
};

export type XrayTlsSettings = {
  serverName?: string;
  allowInsecure?: boolean;
  alpn?: string[];
  certificates?: any[];
  fingerprint?: string;
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
  shortId?: string;    // used in client outbound
  spiderX?: string;    // used in client outbound
};

export type XrayWsSettings = {
  path?: string;
  headers?: Record<string, string>;
};

export type XrayGrpcSettings = {
  serviceName?: string;
  multiMode?: boolean;
};

export type XrayTcpSettings = {
  header?: {
    type: 'none' | 'http';
    request?: any;
    response?: any;
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
  balancers?: any[];
};

export type XrayConfig = {
  log?: XrayLogConfig;
  api?: any;
  dns?: any;
  routing?: XrayRouting;
  policy?: any;
  inbounds?: XrayInbound[];
  outbounds?: XrayOutbound[];
  stats?: any;
  reverse?: any;
  fakedns?: any;
};

