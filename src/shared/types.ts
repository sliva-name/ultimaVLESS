export interface VlessConfig {
  uuid: string;
  address: string;
  port: number;
  name: string;
  source?: 'subscription' | 'manual';
  flow?: string; // xtls-rprx-vision
  encryption?: string;
  type?: 'tcp' | 'kcp' | 'ws' | 'http' | 'grpc' | 'quic';
  security?: 'reality' | 'tls' | 'none';
  sni?: string;
  fp?: string; // chrome, firefox, safari, etc.
  pbk?: string; // reality public key
  sid?: string; // reality short id
  spx?: string; // reality spiderX
  
  // WS specific
  path?: string;
  host?: string;
  
  // gRPC specific
  serviceName?: string;
  
  // Ping information
  ping?: number | null;
  pingTime?: number;

  // Full Xray config from JSON subscription
  rawConfig?: Record<string, any>;
}

export type ConnectionMode = 'proxy' | 'tun';

export interface AppState {
  isConnected: boolean;
  selectedServerId: string | null;
  subscriptionUrl: string;
  servers: VlessConfig[];
  logs: string[];
}
