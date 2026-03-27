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

export type XrayStreamSettings = {
  network: 'tcp' | 'kcp' | 'ws' | 'http' | 'domainsocket' | 'quic' | 'grpc';
  security: 'none' | 'tls' | 'reality';
  tlsSettings?: XrayTlsSettings;
  realitySettings?: XrayRealitySettings;
  wsSettings?: XrayWsSettings;
  grpcSettings?: XrayGrpcSettings;
  tcpSettings?: XrayTcpSettings;
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
  show: boolean;
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
  publicKey?: string;  // used in client outbound
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

