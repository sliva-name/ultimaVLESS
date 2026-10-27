import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/**
 * Contract of the native Android layer (`UltimaCorePlugin.kt`). The WebView
 * runs the desktop main-process logic; this plugin is the platform under it:
 * the Xray core with its VpnService, sockets for probes, files and app info.
 */

export type CoreMode = 'tun' | 'proxy';

export interface VpnOptions {
  mtu: number;
  ipv4Address: string;
  ipv4Prefix: number;
  /** Null keeps IPv6 off the tunnel entirely. */
  ipv6Address: string | null;
  ipv6Prefix: number;
  dnsServers: string[];
  /** Only these packages use the VPN; empty means every app. */
  allowedApps: string[];
  /** Packages that bypass the VPN; ignored when `allowedApps` is not empty. */
  disallowedApps: string[];
}

/** Localized text for the foreground-service notification and the tile. */
export interface NotificationText {
  channelName: string;
  connected: string;
  proxyOnly: string;
  disconnect: string;
}

export interface CoreStartOptions {
  /** Compiled Xray JSON. */
  config: string;
  mode: CoreMode;
  serverId: string;
  /** Server name: VPN session label and notification title. */
  sessionName: string;
  /** Required in `tun` mode. */
  vpn?: VpnOptions;
  text: NotificationText;
}

export interface CoreStatus {
  running: boolean;
  mode: CoreMode | null;
  serverId: string | null;
  sessionName: string | null;
  startedAt: number | null;
}

/**
 * Session changes the WebView did not ask for: the notification's disconnect
 * button, the quick-settings tile, Always-on VPN, or another VPN app taking
 * the tunnel over (`revoked`).
 */
export type CoreEvent =
  | {
      type: 'stopped';
      reason: 'user' | 'revoked' | 'error';
      message?: string;
    }
  | { type: 'started'; serverId: string; mode: CoreMode };

export interface NetworkInterfaceInfo {
  address: string;
  family: 'IPv4' | 'IPv6';
  internal: boolean;
}

export interface HttpRequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  timeoutMs: number;
  /** Loopback HTTP proxy (an Xray `http` inbound) to send the request through. */
  proxyPort?: number;
  followRedirects?: boolean;
  /** Body bytes to read; the rest is dropped and `truncated` is set. */
  maxBodyBytes?: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
}

export interface InstalledApp {
  packageName: string;
  label: string;
  /** PNG data URL, or null. */
  icon: string | null;
  system: boolean;
}

export interface AppInfo {
  version: string;
  versionCode: number;
  packageName: string;
  /** App-private files directory; Xray logs and assets live under it. */
  dataDir: string;
  coreVersion: string;
  abi: string;
  sdkInt: number;
}

export interface UpdateProgress {
  percent: number;
  bytesPerSecond: number;
}

export interface UltimaCorePlugin {
  getAppInfo(): Promise<AppInfo>;
  readState(): Promise<{ json: string | null }>;
  writeState(options: { json: string }): Promise<void>;

  /** Asks for VPN consent when the system has not granted it yet. */
  prepareVpn(): Promise<{ granted: boolean }>;
  requestNotificationPermission(): Promise<{ granted: boolean }>;
  startCore(options: CoreStartOptions): Promise<CoreStatus>;
  /** Stops the core; the tunnel itself closes after a short grace period. */
  stopCore(): Promise<void>;
  getCoreStatus(): Promise<CoreStatus>;
  /** Cumulative bytes of the `proxy` outbound since the core started. */
  getTraffic(): Promise<{ uplink: number; downlink: number }>;

  /** Throwaway core for a real-delay probe. */
  startProbeCore(options: { id: string; config: string }): Promise<void>;
  stopProbeCore(options: { id: string }): Promise<void>;
  allocatePort(): Promise<{ port: number }>;

  tcpConnect(options: {
    host: string;
    port: number;
    timeoutMs: number;
  }): Promise<{ ok: boolean; error?: string }>;
  tlsHandshake(options: {
    host: string;
    port: number;
    sni: string;
    timeoutMs: number;
  }): Promise<{ ok: boolean; error?: string }>;
  httpRequest(options: HttpRequestOptions): Promise<HttpResponse>;
  dnsLookup(options: {
    hostname: string;
  }): Promise<{ addresses: { address: string; family: number }[] }>;
  getNetworkInterfaces(): Promise<{
    interfaces: Record<string, NetworkInterfaceInfo[]>;
  }>;

  appendLog(options: { name: string; text: string }): Promise<void>;
  readLog(options: {
    name: string;
    offset?: number;
    maxBytes?: number;
  }): Promise<{ text: string; size: number; start: number }>;
  logSize(options: { name: string }): Promise<{ size: number }>;
  shareText(options: {
    title: string;
    text: string;
    fileName: string;
  }): Promise<void>;
  openUrl(options: { url: string }): Promise<void>;
  listApps(): Promise<{ apps: InstalledApp[] }>;

  downloadUpdate(options: {
    url: string;
    fileName: string;
  }): Promise<{ path: string }>;
  installUpdate(options: { path: string }): Promise<void>;

  addListener(
    eventName: 'coreEvent',
    listener: (event: CoreEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'networkChanged',
    listener: (event: {
      interfaces: Record<string, NetworkInterfaceInfo[]>;
    }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'updateProgress',
    listener: (event: UpdateProgress) => void,
  ): Promise<PluginListenerHandle>;
}

export const UltimaCore = registerPlugin<UltimaCorePlugin>('UltimaCore', {
  web: () => import('./UltimaCoreWeb').then((m) => new m.UltimaCoreWeb()),
});
