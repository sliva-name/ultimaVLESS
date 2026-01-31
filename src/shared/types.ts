export interface VlessConfig {
  uuid: string;
  address: string;
  port: number;
  name: string;
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
  ping?: number | null; // Latency in milliseconds
  pingTime?: number; // Timestamp when ping was checked
}

export interface AppState {
  isConnected: boolean;
  selectedServerId: string | null;
  subscriptionUrl: string;
  servers: VlessConfig[];
  logs: string[];
}
