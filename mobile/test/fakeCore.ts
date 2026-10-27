import type {
  CoreEvent,
  CoreStartOptions,
  CoreStatus,
  HttpRequestOptions,
  HttpResponse,
} from '../src/native/UltimaCore';

type Listener = (event: unknown) => void;

/**
 * In-memory stand-in for the Android plugin: records what the backend asks
 * of it and answers probes the way a working device would.
 */
export class FakeCore {
  state: string | null = null;
  status: CoreStatus = {
    running: false,
    mode: null,
    serverId: null,
    sessionName: null,
    startedAt: null,
  };
  starts: CoreStartOptions[] = [];
  stops = 0;
  /** Hosts of every TCP probe, loopback readiness checks included. */
  tcpHosts: string[] = [];
  logs = new Map<string, string>();
  httpHandler: (options: HttpRequestOptions) => HttpResponse = () => ({
    status: 204,
    headers: {},
    body: '',
    truncated: false,
  });
  startError: Error | null = null;
  private readonly listeners = new Map<string, Set<Listener>>();

  emit(eventName: string, event: unknown): void {
    for (const listener of this.listeners.get(eventName) ?? []) {
      listener(event);
    }
  }

  emitCore(event: CoreEvent): void {
    if (event.type === 'stopped') {
      this.status = { ...this.status, running: false };
    }
    this.emit('coreEvent', event);
  }

  readonly plugin = {
    getAppInfo: async () => ({
      version: '7.19.0',
      versionCode: 71900,
      packageName: 'com.ultima.vless',
      dataDir: '/data/user/0/com.ultima.vless/files',
      coreVersion: 'Lib v40, Xray-core v26.10.21',
      abi: 'arm64-v8a',
      sdkInt: 36,
    }),
    readState: async () => ({ json: this.state }),
    writeState: async ({ json }: { json: string }) => {
      this.state = json;
    },
    prepareVpn: async () => ({ granted: true }),
    requestNotificationPermission: async () => ({ granted: true }),
    startCore: async (options: CoreStartOptions) => {
      JSON.parse(options.config);
      if (this.startError) throw this.startError;
      this.starts.push(options);
      this.status = {
        running: true,
        mode: options.mode,
        serverId: options.serverId,
        sessionName: options.sessionName,
        startedAt: Date.now(),
      };
      return { ...this.status };
    },
    stopCore: async () => {
      this.stops += 1;
      this.status = {
        running: false,
        mode: null,
        serverId: null,
        sessionName: null,
        startedAt: null,
      };
    },
    getCoreStatus: async () => ({ ...this.status }),
    getTraffic: async () => ({ uplink: 1000, downlink: 5000 }),
    startProbeCore: async () => undefined,
    stopProbeCore: async () => undefined,
    allocatePort: async () => ({ port: 23456 }),
    tcpConnect: async ({ host }: { host: string }) => {
      this.tcpHosts.push(host);
      return { ok: true };
    },
    tlsHandshake: async () => ({ ok: true }),
    httpRequest: async (options: HttpRequestOptions) =>
      this.httpHandler(options),
    dnsLookup: async () => ({
      addresses: [{ address: '203.0.113.10', family: 4 }],
    }),
    getNetworkInterfaces: async () => ({
      interfaces: {
        wlan0: [
          { address: '192.168.1.20', family: 'IPv4' as const, internal: false },
        ],
      },
    }),
    appendLog: async ({ name, text }: { name: string; text: string }) => {
      this.logs.set(name, (this.logs.get(name) ?? '') + text);
    },
    readLog: async ({
      name,
      offset = 0,
    }: {
      name: string;
      offset?: number;
    }) => {
      const text = this.logs.get(name) ?? '';
      return { text: text.slice(offset), size: text.length, start: offset };
    },
    logSize: async ({ name }: { name: string }) => ({
      size: (this.logs.get(name) ?? '').length,
    }),
    shareText: async () => undefined,
    openUrl: async () => undefined,
    listApps: async () => ({
      apps: [
        {
          packageName: 'org.telegram.messenger',
          label: 'Telegram',
          icon: null,
          system: false,
        },
      ],
    }),
    downloadUpdate: async () => ({ path: '/cache/update.apk' }),
    installUpdate: async () => undefined,
    addListener: async (eventName: string, listener: Listener) => {
      const set = this.listeners.get(eventName) ?? new Set<Listener>();
      set.add(listener);
      this.listeners.set(eventName, set);
      return { remove: async () => void set.delete(listener) };
    },
  };
}
