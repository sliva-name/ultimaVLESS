import { WebPlugin } from '@capacitor/core';
import type {
  AppInfo,
  CoreStartOptions,
  CoreStatus,
  HttpRequestOptions,
  HttpResponse,
  InstalledApp,
  NetworkInterfaceInfo,
  UltimaCorePlugin,
} from './UltimaCore';

const STATE_KEY = 'ultima-mobile-state';
const LOG_PREFIX = 'ultima-mobile-log:';

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: state lives for this page only */
  }
}

/** Stable pseudo-latency so the preview list does not reshuffle per ping. */
function fakeLatency(host: string, port: number): number {
  let hash = port;
  for (const char of host) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return 40 + (hash % 260);
}

/**
 * Browser stand-in for the Android plugin, used by `npm run dev` to work on
 * the UI without a device. It pretends the core starts and every probe
 * answers; real networking only happens on Android.
 */
export class UltimaCoreWeb extends WebPlugin implements UltimaCorePlugin {
  private status: CoreStatus = {
    running: false,
    mode: null,
    serverId: null,
    sessionName: null,
    startedAt: null,
  };

  async getAppInfo(): Promise<AppInfo> {
    return {
      version: import.meta.env.VITE_APP_VERSION ?? '0.0.0',
      versionCode: 0,
      packageName: 'com.ultima.vless',
      dataDir: '/web',
      coreVersion: 'web preview',
      abi: 'web',
      sdkInt: 0,
    };
  }

  async readState(): Promise<{ json: string | null }> {
    return { json: readStorage(STATE_KEY) };
  }

  async writeState({ json }: { json: string }): Promise<void> {
    writeStorage(STATE_KEY, json);
  }

  async prepareVpn(): Promise<{ granted: boolean }> {
    return { granted: true };
  }

  async requestNotificationPermission(): Promise<{ granted: boolean }> {
    return { granted: true };
  }

  async startCore(options: CoreStartOptions): Promise<CoreStatus> {
    JSON.parse(options.config);
    this.status = {
      running: true,
      mode: options.mode,
      serverId: options.serverId,
      sessionName: options.sessionName,
      startedAt: this.status.running ? this.status.startedAt : Date.now(),
    };
    return { ...this.status };
  }

  async stopCore(): Promise<void> {
    this.status = {
      running: false,
      mode: null,
      serverId: null,
      sessionName: null,
      startedAt: null,
    };
  }

  async getCoreStatus(): Promise<CoreStatus> {
    return { ...this.status };
  }

  async getTraffic(): Promise<{ uplink: number; downlink: number }> {
    const seconds = this.status.startedAt
      ? (Date.now() - this.status.startedAt) / 1000
      : 0;
    return {
      uplink: Math.round(seconds * 2_500),
      downlink: Math.round(seconds * 48_000),
    };
  }

  async startProbeCore(): Promise<void> {}

  async stopProbeCore(): Promise<void> {}

  async allocatePort(): Promise<{ port: number }> {
    return { port: 20000 + Math.floor(Math.random() * 20000) };
  }

  async tcpConnect({
    host,
    port,
  }: {
    host: string;
    port: number;
  }): Promise<{ ok: boolean }> {
    await new Promise((r) => setTimeout(r, fakeLatency(host, port)));
    return { ok: true };
  }

  async tlsHandshake(): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async httpRequest(options: HttpRequestOptions): Promise<HttpResponse> {
    if (options.proxyPort !== undefined) {
      return { status: 204, headers: {}, body: '', truncated: false };
    }
    const response = await fetch(options.url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      redirect: options.followRedirects === false ? 'manual' : 'follow',
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return {
      status: response.status,
      headers,
      body: await response.text(),
      truncated: false,
    };
  }

  async dnsLookup(): Promise<{
    addresses: { address: string; family: number }[];
  }> {
    return { addresses: [{ address: '93.184.215.14', family: 4 }] };
  }

  async getNetworkInterfaces(): Promise<{
    interfaces: Record<string, NetworkInterfaceInfo[]>;
  }> {
    return {
      interfaces: {
        wlan0: [{ address: '192.168.1.10', family: 'IPv4', internal: false }],
      },
    };
  }

  async appendLog({ name, text }: { name: string; text: string }) {
    const key = LOG_PREFIX + name;
    const next = ((readStorage(key) ?? '') + text).slice(-200_000);
    writeStorage(key, next);
  }

  async readLog({ name, offset = 0 }: { name: string; offset?: number }) {
    const text = readStorage(LOG_PREFIX + name) ?? '';
    return { text: text.slice(offset), size: text.length, start: offset };
  }

  async logSize({ name }: { name: string }) {
    return { size: (readStorage(LOG_PREFIX + name) ?? '').length };
  }

  async shareText({ text }: { text: string }): Promise<void> {
    await navigator.clipboard?.writeText(text);
  }

  async openUrl({ url }: { url: string }): Promise<void> {
    window.open(url, '_blank', 'noopener');
  }

  async listApps(): Promise<{ apps: InstalledApp[] }> {
    return {
      apps: [
        {
          packageName: 'org.telegram.messenger',
          label: 'Telegram',
          icon: null,
          system: false,
        },
        {
          packageName: 'com.android.chrome',
          label: 'Chrome',
          icon: null,
          system: false,
        },
      ],
    };
  }

  async downloadUpdate(): Promise<{ path: string }> {
    throw this.unavailable('Updates are installed on Android only');
  }

  async installUpdate(): Promise<void> {
    throw this.unavailable('Updates are installed on Android only');
  }
}
