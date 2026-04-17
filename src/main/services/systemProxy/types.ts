export interface WindowsProxySnapshot {
  platform: 'win32';
  proxyEnable: number;
  proxyServer: string | null;
  proxyOverride: string | null;
  autoConfigUrl: string | null;
  autoDetect: number;
}

export interface MacosServiceProxySnapshot {
  service: string;
  webEnabled: boolean;
  webHost: string | null;
  webPort: number | null;
  secureEnabled: boolean;
  secureHost: string | null;
  securePort: number | null;
  socksEnabled: boolean;
  socksHost: string | null;
  socksPort: number | null;
}

export interface MacosProxySnapshot {
  platform: 'darwin';
  services: MacosServiceProxySnapshot[];
}

export interface LinuxProxySnapshot {
  platform: 'linux';
  backend: 'gsettings' | 'unsupported';
  mode: string;
  httpHost: string;
  httpPort: number;
  httpsHost: string;
  httpsPort: number;
  socksHost: string;
  socksPort: number;
}

export type ProxySnapshot = WindowsProxySnapshot | MacosProxySnapshot | LinuxProxySnapshot;
