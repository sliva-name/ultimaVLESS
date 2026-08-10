import { BUNDLED_XRAY_VERSION } from '@/shared/constants';
import {
  ConnectionMode,
  DEFAULT_PERFORMANCE_SETTINGS,
  PerformanceSettings,
  VlessConfig,
} from '@/shared/types';
import {
  XrayConfig,
  XrayOutbound,
  XrayInbound,
  XrayStreamSettings,
  XrayMuxSettings,
  XrayRoutingRule,
} from '@/shared/xray-types';
import {
  createLocalProxyInbounds,
  createTunInbound,
  ensureLocalProxyInbounds,
} from './configGenerator/inbounds';
import {
  assertAllowInsecureNotUsed,
  assertEncryptedPublicOutbound,
  assertSupportedShadowsocksMethod,
  normalizeVmessSecurity,
  requiresPublicTrojanMux,
} from './configGenerator/outboundCompat';
import { buildDefaultRoutingRules } from './configGenerator/routing';
import { applyStatsApi } from './configGenerator/statsApi';

type MutableConfigNode = Record<string, unknown>;

type MutableSockopt = MutableConfigNode & { tcpFastOpen?: boolean };
type MutableStreamSettings = MutableConfigNode & {
  sockopt?: MutableSockopt;
  method?: string;
  network?: string;
  xhttpSettings?: MutableConfigNode;
  splithttpSettings?: MutableConfigNode;
};
type MutableOutbound = MutableConfigNode & {
  protocol?: string;
  tag?: string;
  settings?: MutableConfigNode;
  streamSettings?: MutableStreamSettings;
  mux?: MutableConfigNode;
};

type StructuredOutboundProtocol =
  | 'vless'
  | 'vmess'
  | 'trojan'
  | 'shadowsocks'
  | 'hysteria'
  | 'wireguard';

function bundledVersionMin(): string {
  return BUNDLED_XRAY_VERSION.replace(/^v/i, '');
}

export interface XrayConfigPipelineOptions {
  sendThrough?: string;
  tunAutoRoute?: boolean;
  performanceSettings?: PerformanceSettings;
}

export class XrayConfigPipeline {
  static generate(
    config: VlessConfig,
    logPath: string,
    connectionMode: ConnectionMode = 'proxy',
    options: XrayConfigPipelineOptions = {},
  ): XrayConfig {
    if (config.rawConfig) {
      return this.applyRawConfig(
        config.rawConfig,
        logPath,
        connectionMode,
        options,
      );
    }
    return this.generateFromFields(config, logPath, connectionMode, options);
  }

  private static applyRawConfig(
    rawConfig: XrayConfig,
    logPath: string,
    connectionMode: ConnectionMode,
    options: XrayConfigPipelineOptions,
  ): XrayConfig {
    const cfg = JSON.parse(JSON.stringify(rawConfig)) as XrayConfig;
    const perf = options.performanceSettings ?? DEFAULT_PERFORMANCE_SETTINGS;

    cfg.log = {
      loglevel: perf.logLevel,
      access: logPath,
      error: logPath,
    };

    if (!cfg.inbounds || !Array.isArray(cfg.inbounds)) {
      cfg.inbounds = [];
    }

    ensureLocalProxyInbounds(cfg.inbounds, perf.sniffingRouteOnly);
    const hasTun = cfg.inbounds.some(
      (ib) => ib?.protocol === 'tun' || ib?.tag === 'tun-in',
    );

    if (connectionMode === 'tun' && !hasTun) {
      cfg.inbounds.unshift(createTunInbound(options));
      // Prefer autoOutboundsInterface for loop prevention; sendThrough is
      // dual-stack-limited and only needed when Xray auto-route is off.
      if (!options.tunAutoRoute) {
        this.applySendThroughIfNeeded(cfg, options.sendThrough);
      }
    }

    // Raw subscriptions often omit the `block` / `direct` outbounds that are
    // mandatory once routing rules reference them (either from the raw config
    // itself or from the ad/bittorrent blockers injected below). Xray refuses
    // to start with "outboundTag not found" otherwise.
    this.ensureAuxiliaryOutbounds(cfg);
    this.applyPerfToOutbounds(cfg, perf);
    this.applyPerfToRouting(cfg, perf);
    if (connectionMode === 'tun') {
      this.applyTunDnsDefaults(cfg);
    }
    this.assertRawOutboundCompatibility(cfg);
    applyStatsApi(cfg);
    this.applyBundledVersionConstraint(cfg);

    return cfg;
  }

  /**
   * TUN + raw subscriptions: Keep DNS fast and IPv4-first.
   * Ultima raw configs ship 8.8.8.8/8.8.4.4 with serial fallback; through the
   * tunnel the first server often times out (~4s) before 8.8.4.4 answers
   * (~3–8s RTT) — ~12s until the first browser request. Use the same resolvers
   * as structured profiles (which start traffic in <1s on the same path).
   */
  private static applyTunDnsDefaults(cfg: XrayConfig): void {
    const dns =
      cfg.dns && typeof cfg.dns === 'object'
        ? (cfg.dns as Record<string, unknown>)
        : {};
    cfg.dns = {
      ...dns,
      // localhost first: answer from the OS without waiting for a cold tunnel.
      servers: ['localhost', '1.1.1.1', '1.0.0.1'],
      queryStrategy: 'UseIPv4',
    };
  }

  private static applyBundledVersionConstraint(cfg: XrayConfig): void {
    const existing = cfg.version && typeof cfg.version === 'object' ? cfg.version : {};
    cfg.version = {
      ...existing,
      min: bundledVersionMin(),
    };
  }

  private static ensureAuxiliaryOutbounds(cfg: XrayConfig): void {
    if (!Array.isArray(cfg.outbounds)) {
      cfg.outbounds = [];
    }
    const outbounds = cfg.outbounds as MutableOutbound[];
    const hasTag = (tag: string): boolean =>
      outbounds.some((o) => o?.tag === tag);
    if (!hasTag('direct')) {
      outbounds.push({ tag: 'direct', protocol: 'freedom', settings: {} });
    }
    if (!hasTag('block')) {
      outbounds.push({ tag: 'block', protocol: 'blackhole', settings: {} });
    }
  }

  private static applyPerfToOutbounds(
    cfg: XrayConfig,
    perf: PerformanceSettings,
  ): void {
    if (!Array.isArray(cfg.outbounds)) return;
    for (const outbound of cfg.outbounds as MutableOutbound[]) {
      if (!outbound || (outbound.tag && outbound.tag !== 'proxy')) continue;
      if (!this.isTunableProxyProtocol(outbound.protocol)) continue;
      // WireGuard docs forbid streamSettings on the outbound.
      if (outbound.protocol === 'wireguard') continue;

      if (!outbound.streamSettings) outbound.streamSettings = {};
      this.normalizeStreamSettings(outbound.streamSettings);
      this.applyXhttpMaxConnections(
        outbound.streamSettings,
        perf.xhttpMaxConnections,
      );
      if (!outbound.streamSettings.sockopt) {
        outbound.streamSettings.sockopt = { tcpFastOpen: perf.tcpFastOpen };
      } else if (outbound.streamSettings.sockopt.tcpFastOpen === undefined) {
        outbound.streamSettings.sockopt.tcpFastOpen = perf.tcpFastOpen;
      }

      const hasVisionFlow = this.outboundHasVisionFlow(outbound);
      // Always rewrite Vision mux: raw subs often leave XUDP mux on, and TUN
      // DNS (udp/53) then waits on the mux client → ~12s cold-start stall.
      if (!outbound.mux || hasVisionFlow) {
        const address = this.readOutboundAddress(outbound);
        const forceMux =
          outbound.protocol === 'trojan' &&
          !!address &&
          requiresPublicTrojanMux(address);
        outbound.mux = this.buildMuxSettings(
          outbound.streamSettings.method ?? outbound.streamSettings.network,
          hasVisionFlow,
          perf,
          { forceMux },
        );
      }
    }
  }

  private static assertRawOutboundCompatibility(cfg: XrayConfig): void {
    if (!Array.isArray(cfg.outbounds)) return;
    for (const outbound of cfg.outbounds as MutableOutbound[]) {
      if (!outbound || !this.isTunableProxyProtocol(outbound.protocol)) continue;
      const protocol = String(outbound.protocol);
      const stream = outbound.streamSettings;
      const streamSecurity =
        typeof stream?.security === 'string' ? stream.security : undefined;
      const tlsSettings = stream?.tlsSettings as
        | Record<string, unknown>
        | undefined;
      if (tlsSettings) {
        assertAllowInsecureNotUsed(tlsSettings.allowInsecure);
        delete tlsSettings.allowInsecure;
      }

      if (protocol === 'shadowsocks') {
        const method = this.readShadowsocksMethod(outbound);
        if (method !== undefined) {
          assertSupportedShadowsocksMethod(method);
        }
      }

      if (protocol === 'vmess') {
        this.coerceRawVmessSecurity(outbound);
      }

      if (
        protocol === 'vless' ||
        protocol === 'trojan' ||
        protocol === 'hysteria'
      ) {
        const address = this.readOutboundAddress(outbound);
        if (!address) continue;
        assertEncryptedPublicOutbound({
          protocol,
          address,
          streamSecurity,
          vlessEncryption: this.readVlessEncryption(outbound),
        });
      }
    }
  }

  private static readOutboundAddress(
    outbound: MutableOutbound,
  ): string | undefined {
    const settings = outbound.settings;
    if (!settings) return undefined;
    if (typeof settings.address === 'string' && settings.address) {
      return settings.address;
    }
    const vnext = settings.vnext;
    if (Array.isArray(vnext) && vnext[0] && typeof vnext[0] === 'object') {
      const address = (vnext[0] as Record<string, unknown>).address;
      if (typeof address === 'string' && address) return address;
    }
    const servers = settings.servers;
    if (Array.isArray(servers) && servers[0] && typeof servers[0] === 'object') {
      const address = (servers[0] as Record<string, unknown>).address;
      if (typeof address === 'string' && address) return address;
    }
    return undefined;
  }

  private static readVlessEncryption(
    outbound: MutableOutbound,
  ): string | undefined {
    const settings = outbound.settings;
    if (!settings) return undefined;
    if (typeof settings.encryption === 'string') return settings.encryption;
    const vnext = settings.vnext;
    if (!Array.isArray(vnext) || !vnext[0] || typeof vnext[0] !== 'object') {
      return undefined;
    }
    const users = (vnext[0] as Record<string, unknown>).users;
    if (!Array.isArray(users) || !users[0] || typeof users[0] !== 'object') {
      return undefined;
    }
    const encryption = (users[0] as Record<string, unknown>).encryption;
    return typeof encryption === 'string' ? encryption : undefined;
  }

  private static readShadowsocksMethod(
    outbound: MutableOutbound,
  ): string | undefined {
    const settings = outbound.settings;
    if (!settings) return undefined;
    if (typeof settings.method === 'string') return settings.method;
    const servers = settings.servers;
    if (Array.isArray(servers) && servers[0] && typeof servers[0] === 'object') {
      const method = (servers[0] as Record<string, unknown>).method;
      if (typeof method === 'string') return method;
    }
    return undefined;
  }

  private static coerceRawVmessSecurity(outbound: MutableOutbound): void {
    const settings = outbound.settings;
    if (!settings) return;
    if (typeof settings.security === 'string') {
      settings.security = normalizeVmessSecurity(settings.security);
    }
    const vnext = settings.vnext;
    if (!Array.isArray(vnext)) return;
    for (const server of vnext) {
      if (!server || typeof server !== 'object') continue;
      const users = (server as Record<string, unknown>).users;
      if (!Array.isArray(users)) continue;
      for (const user of users) {
        if (!user || typeof user !== 'object') continue;
        const account = user as Record<string, unknown>;
        if (typeof account.security === 'string') {
          account.security = normalizeVmessSecurity(account.security);
        }
      }
    }
  }

  private static isTunableProxyProtocol(protocol: unknown): boolean {
    return (
      protocol === 'vless' ||
      protocol === 'vmess' ||
      protocol === 'trojan' ||
      protocol === 'shadowsocks' ||
      protocol === 'hysteria' ||
      protocol === 'wireguard'
    );
  }

  private static normalizeStreamSettings(
    streamSettings: MutableStreamSettings,
  ): void {
    // Docs canonicalize on `method` (default `raw`); `network` remains an alias.
    // Keep both in sync and map tcp ↔ raw for maximum compatibility.
    if (streamSettings.method === 'tcp') {
      streamSettings.method = 'raw';
    }
    if (
      streamSettings.method === undefined &&
      typeof streamSettings.network === 'string'
    ) {
      streamSettings.method =
        streamSettings.network === 'tcp' ? 'raw' : streamSettings.network;
    }
    if (typeof streamSettings.method === 'string') {
      if (streamSettings.network === undefined || streamSettings.network === 'raw') {
        streamSettings.network =
          streamSettings.method === 'raw' ? 'tcp' : streamSettings.method;
      }
    }

    const realitySettings = streamSettings.realitySettings;
    if (
      realitySettings &&
      typeof realitySettings === 'object' &&
      !Array.isArray(realitySettings)
    ) {
      const reality = realitySettings as Record<string, unknown>;
      if (reality.password === undefined && reality.publicKey !== undefined) {
        reality.password = reality.publicKey;
      }
      delete reality.publicKey;
    }

    const grpcSettings = streamSettings.grpcSettings;
    if (
      grpcSettings &&
      typeof grpcSettings === 'object' &&
      !Array.isArray(grpcSettings)
    ) {
      const grpc = grpcSettings as Record<string, unknown>;
      if (grpc.multiMode === undefined && typeof grpc.mode === 'boolean') {
        grpc.multiMode = grpc.mode;
      }
      delete grpc.mode;
      if (grpc.authority === '') {
        delete grpc.authority;
      }
    }

    const wsSettings = streamSettings.wsSettings;
    if (
      wsSettings &&
      typeof wsSettings === 'object' &&
      !Array.isArray(wsSettings)
    ) {
      const ws = wsSettings as Record<string, unknown>;
      const headers =
        ws.headers &&
        typeof ws.headers === 'object' &&
        !Array.isArray(ws.headers)
          ? (ws.headers as Record<string, unknown>)
          : undefined;
      const hostHeader = headers
        ? Object.keys(headers).find((key) => key.toLowerCase() === 'host')
        : undefined;
      if (hostHeader) {
        if (
          ws.host === undefined &&
          typeof headers?.[hostHeader] === 'string'
        ) {
          ws.host = headers[hostHeader];
        }
        delete headers?.[hostHeader];
      }
      if (typeof ws.maxEarlyData === 'number') {
        ws.path = this.withWebSocketEarlyData(
          typeof ws.path === 'string' ? ws.path : '/',
          ws.maxEarlyData,
        );
      }
      delete ws.maxEarlyData;
      delete ws.earlyDataHeaderName;
    }

    const xhttpSettings =
      streamSettings.xhttpSettings || streamSettings.splithttpSettings;
    if (
      xhttpSettings &&
      typeof xhttpSettings === 'object' &&
      !Array.isArray(xhttpSettings)
    ) {
      const xhttp = xhttpSettings as Record<string, unknown>;
      const headers =
        xhttp.headers &&
        typeof xhttp.headers === 'object' &&
        !Array.isArray(xhttp.headers)
          ? (xhttp.headers as Record<string, unknown>)
          : undefined;
      const hostHeader = headers
        ? Object.keys(headers).find((key) => key.toLowerCase() === 'host')
        : undefined;
      if (hostHeader) {
        if (
          xhttp.host === undefined &&
          typeof headers?.[hostHeader] === 'string'
        ) {
          xhttp.host = headers[hostHeader];
        }
        delete headers?.[hostHeader];
      }
    }
  }

  private static outboundHasVisionFlow(outbound: MutableOutbound): boolean {
    const settings = outbound.settings as MutableConfigNode | undefined;
    if (!settings) return false;
    // Simplified VLESS outbound (current Project X docs).
    if (typeof settings.flow === 'string' && settings.flow.trim() !== '') {
      return true;
    }
    // Legacy vnext form still appears in some subscription JSON.
    const vnext = settings.vnext;
    if (!Array.isArray(vnext)) return false;
    for (const server of vnext) {
      if (!server || typeof server !== 'object') continue;
      const users = (server as Record<string, unknown>).users;
      if (!Array.isArray(users)) continue;
      for (const user of users as Array<Record<string, unknown>>) {
        if (
          user.flow &&
          typeof user.flow === 'string' &&
          user.flow.trim() !== ''
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private static applyPerfToRouting(
    cfg: XrayConfig,
    perf: PerformanceSettings,
  ): void {
    if (!cfg.routing || typeof cfg.routing !== 'object') {
      cfg.routing = { domainStrategy: perf.domainStrategy, rules: [] };
    }

    const rules: Array<Record<string, unknown>> = Array.isArray(
      cfg.routing.rules,
    )
      ? cfg.routing.rules
      : [];

    const hasAdBlock = rules.some(
      (r) =>
        Array.isArray(r.domain) &&
        r.domain.some(
          (d: unknown) => typeof d === 'string' && d.includes('category-ads'),
        ),
    );
    const hasBtBlock = rules.some(
      (r) =>
        Array.isArray(r.protocol) &&
        (r.protocol as unknown[]).includes('bittorrent') &&
        r.outboundTag === 'block',
    );

    const rulesLenBeforeInjections = rules.length;

    // Prepend block rules in reverse priority so the final order is:
    //   [ads?, bittorrent?, ...existing rules]
    if (perf.blockBittorrent && !hasBtBlock) {
      const btIndex = rules.findIndex(
        (r) => Array.isArray(r.protocol) && r.protocol.includes('bittorrent'),
      );
      if (btIndex >= 0) {
        rules[btIndex].outboundTag = 'block';
      } else {
        rules.unshift({
          type: 'field',
          protocol: ['bittorrent'],
          outboundTag: 'block',
        });
      }
    }
    if (perf.blockAds && !hasAdBlock) {
      rules.unshift({
        type: 'field',
        domain: ['geosite:category-ads-all'],
        outboundTag: 'block',
      });
    }

    const injectedBlockCount = rules.length - rulesLenBeforeInjections;

    // Subscriptions often omit private / link-local bypass. Without it, Windows
    // may deliver IPv6 link-local DNS (fe80::/10) into the TUN and Xray sends
    // it through the remote proxy, which breaks resolution until users disable
    // IPv6 OS-wide. Uses the same `geoip:private` → `direct` rule as
    // buildRoutingRules(); per Project X routing docs, `geoip:private` covers
    // private addresses (see RuleObject `ip` and `geoip:private`):
    // https://xtls.github.io/config/routing.html
    if (!this.routingHasPrivateIpDirectBypass(rules)) {
      rules.splice(injectedBlockCount, 0, {
        type: 'field',
        ip: ['geoip:private'],
        outboundTag: 'direct',
      });
    }

    cfg.routing.rules = rules as XrayRoutingRule[];
  }

  /** True if routing already sends geoip:private to direct (any rule). */
  private static routingHasPrivateIpDirectBypass(
    rules: Array<Record<string, unknown>>,
  ): boolean {
    return rules.some((r) => {
      if (r.outboundTag !== 'direct' || !Array.isArray(r.ip)) return false;
      return (r.ip as unknown[]).some((ip) => ip === 'geoip:private');
    });
  }

  private static getStructuredProtocol(
    config: VlessConfig,
  ): StructuredOutboundProtocol {
    if (config.protocol === 'trojan') return 'trojan';
    if (config.protocol === 'shadowsocks') return 'shadowsocks';
    if (config.protocol === 'vmess') return 'vmess';
    if (config.protocol === 'hysteria') return 'hysteria';
    if (config.protocol === 'wireguard') return 'wireguard';
    return 'vless';
  }

  /** Canonical transport name for `streamSettings.method` (Project X docs). */
  private static normalizeTransport(
    config: VlessConfig,
  ): NonNullable<XrayStreamSettings['method']> {
    const transport = config.type || 'tcp';
    switch (transport) {
      case 'raw':
      case 'tcp':
        return 'raw';
      case 'kcp':
      case 'mkcp':
        return 'mkcp';
      case 'ws':
      case 'websocket':
        return 'websocket';
      case 'grpc':
        return 'grpc';
      case 'xhttp':
      case 'splithttp':
        return 'xhttp';
      case 'httpupgrade':
        return 'httpupgrade';
      case 'hysteria':
        return 'hysteria';
      case 'http':
        throw new Error(
          `HTTP transport is not supported by bundled Xray ${BUNDLED_XRAY_VERSION}; use XHTTP instead.`,
        );
      case 'quic':
        throw new Error(
          `QUIC transport is not supported by bundled Xray ${BUNDLED_XRAY_VERSION}; use XHTTP/H3 instead.`,
        );
      default:
        return 'raw';
    }
  }

  /** Alias value for legacy `network` readers (`raw` ↔ `tcp`). */
  private static transportNetworkAlias(
    method: NonNullable<XrayStreamSettings['method']>,
  ): XrayStreamSettings['network'] {
    return method === 'raw' ? 'tcp' : method;
  }

  private static tlsAlpnForTransport(
    method: NonNullable<XrayStreamSettings['method']>,
  ): string[] {
    // uTLS defaults WS/HTTPUpgrade to http/1.1; negotiating h2 first often breaks them.
    if (method === 'websocket' || method === 'httpupgrade') {
      return ['http/1.1'];
    }
    return ['h2', 'http/1.1'];
  }

  private static getDefaultSecurity(
    config: VlessConfig,
    protocol: StructuredOutboundProtocol,
  ): XrayStreamSettings['security'] {
    if (config.security) return config.security;
    if (protocol === 'trojan' || protocol === 'hysteria') return 'tls';
    return 'none';
  }

  private static withWebSocketEarlyData(
    path: string,
    maxEarlyData?: number,
  ): string {
    if (!maxEarlyData || maxEarlyData <= 0) return path;
    const [pathname, query = ''] = path.split('?', 2);
    const params = new URLSearchParams(query);
    params.set('ed', String(Math.min(maxEarlyData, 8192)));
    const serialized = params.toString();
    return serialized ? `${pathname || '/'}?${serialized}` : pathname || '/';
  }

  private static generateFromFields(
    config: VlessConfig,
    logPath: string,
    connectionMode: ConnectionMode,
    options: XrayConfigPipelineOptions,
  ): XrayConfig {
    const perf = options.performanceSettings ?? DEFAULT_PERFORMANCE_SETTINGS;
    const protocol = this.getStructuredProtocol(config);
    assertAllowInsecureNotUsed(config.allowInsecure);

    const outbound =
      protocol === 'wireguard'
        ? this.buildWireGuardOutbound(config)
        : this.buildStreamOutbound(config, protocol, perf);

    const inbounds: XrayInbound[] = createLocalProxyInbounds(
      perf.sniffingRouteOnly,
    );
    if (connectionMode === 'tun') {
      inbounds.unshift(createTunInbound(options) as XrayInbound);
    }

    const cfg: XrayConfig = {
      log: {
        loglevel: perf.logLevel,
        access: logPath,
        error: logPath,
      },
      dns: {
        servers: ['1.1.1.1', '1.0.0.1', 'localhost'],
        queryStrategy: 'UseIPv4',
      },
      inbounds,
      outbounds: [
        outbound,
        { protocol: 'freedom', tag: 'direct', settings: {} },
        { protocol: 'blackhole', tag: 'block', settings: {} },
      ],
      routing: {
        domainStrategy: perf.domainStrategy,
        rules: buildDefaultRoutingRules(perf),
      },
    };

    if (
      connectionMode === 'tun' &&
      options.sendThrough &&
      !options.tunAutoRoute
    ) {
      this.applySendThroughIfNeeded(cfg, options.sendThrough);
    }

    applyStatsApi(cfg);
    this.applyBundledVersionConstraint(cfg);
    return cfg;
  }

  private static buildWireGuardOutbound(config: VlessConfig): XrayOutbound {
    if (!config.wgSecretKey) {
      throw new Error('WireGuard outbound requires wgSecretKey.');
    }
    if (!config.wgAddress?.length) {
      throw new Error('WireGuard outbound requires wgAddress.');
    }
    if (!config.wgPeers?.length) {
      throw new Error('WireGuard outbound requires at least one peer.');
    }

    const settings: Record<string, unknown> = {
      secretKey: config.wgSecretKey,
      address: config.wgAddress,
      peers: config.wgPeers.map((peer) => {
        const entry: Record<string, unknown> = {
          endpoint: peer.endpoint,
          publicKey: peer.publicKey,
        };
        if (peer.preSharedKey) entry.preSharedKey = peer.preSharedKey;
        if (peer.keepAlive !== undefined) entry.keepAlive = peer.keepAlive;
        if (peer.allowedIPs?.length) entry.allowedIPs = peer.allowedIPs;
        return entry;
      }),
    };
    if (config.wgMtu !== undefined) settings.mtu = config.wgMtu;
    if (config.wgReserved?.length) settings.reserved = config.wgReserved;
    if (config.wgNoKernelTun !== undefined) {
      settings.noKernelTun = config.wgNoKernelTun;
    }
    if (config.wgDomainStrategy) {
      settings.domainStrategy = config.wgDomainStrategy;
    }

    const outbound: XrayOutbound = {
      protocol: 'wireguard',
      settings,
      tag: 'proxy',
    };
    return outbound;
  }

  private static buildStreamOutbound(
    config: VlessConfig,
    protocol: Exclude<StructuredOutboundProtocol, 'wireguard'>,
    perf: PerformanceSettings,
  ): XrayOutbound {
    const transport =
      protocol === 'hysteria' ? 'hysteria' : this.normalizeTransport(config);
    const streamSettings: XrayStreamSettings = {
      method: transport,
      network: this.transportNetworkAlias(transport),
      security: this.getDefaultSecurity(config, protocol),
    };
    if (protocol === 'hysteria') {
      streamSettings.method = 'hysteria';
      streamSettings.network = 'hysteria';
      streamSettings.security = 'tls';
    }
    if (
      streamSettings.security === 'reality' &&
      !['raw', 'tcp', 'xhttp', 'grpc'].includes(transport)
    ) {
      throw new Error('REALITY transport requires RAW/TCP, XHTTP, or gRPC.');
    }

    if (protocol === 'shadowsocks') {
      assertSupportedShadowsocksMethod(config.method || '');
    }
    assertEncryptedPublicOutbound({
      protocol,
      address: config.address,
      streamSecurity: streamSettings.security,
      vlessEncryption: config.encryption,
    });

    const defaultFp = perf.fingerprint;

    if (streamSettings.security === 'reality') {
      streamSettings.realitySettings = {
        fingerprint: config.fp || defaultFp,
        serverName: config.sni || '',
        password: config.pbk || '',
        shortId: config.sid || '',
        spiderX: config.spx || '',
      };
      if (config.mldsa65Verify) {
        streamSettings.realitySettings.mldsa65Verify = config.mldsa65Verify;
      }
    } else if (streamSettings.security === 'tls') {
      streamSettings.tlsSettings = {
        serverName: config.sni || '',
        alpn: this.tlsAlpnForTransport(transport),
        fingerprint: config.fp || defaultFp,
      };
      if (config.pinnedPeerCertSha256) {
        streamSettings.tlsSettings.pinnedPeerCertSha256 =
          config.pinnedPeerCertSha256;
      }
      if (config.verifyPeerCertByName) {
        streamSettings.tlsSettings.verifyPeerCertByName =
          config.verifyPeerCertByName;
      }
      if (config.echConfigList) {
        streamSettings.tlsSettings.echConfigList = config.echConfigList;
      }
    }

    if (protocol === 'hysteria') {
      const auth = config.hysteriaAuth || config.password || '';
      if (!auth) {
        throw new Error('Hysteria outbound requires hysteriaAuth (or password).');
      }
      streamSettings.hysteriaSettings = {
        version: 2,
        auth,
      };
    }

    if (transport === 'websocket') {
      streamSettings.wsSettings = {
        path: this.withWebSocketEarlyData(
          config.path || '/',
          config.wsMaxEarlyData,
        ),
        host: config.host || config.sni || '',
      };
    }

    if (transport === 'httpupgrade') {
      streamSettings.httpupgradeSettings = {
        path: this.withWebSocketEarlyData(
          config.path || '/',
          config.wsMaxEarlyData,
        ),
        host: config.host || config.sni || '',
      } as Record<string, unknown>;
    }

    if (transport === 'grpc') {
      streamSettings.grpcSettings = {
        serviceName: config.serviceName || '',
      };
    }

    if (transport === 'xhttp') {
      const extra =
        config.xhttpExtra || config.noGRPCHeader !== undefined
          ? {
              ...(config.xhttpExtra ?? {}),
              ...(config.noGRPCHeader !== undefined
                ? { noGRPCHeader: config.noGRPCHeader }
                : {}),
            }
          : undefined;
      streamSettings.xhttpSettings = {
        path: config.path || '/',
        host: config.host || config.sni || '',
      };
      if (config.mode) {
        streamSettings.xhttpSettings.mode = config.mode;
      }
      if (extra) {
        streamSettings.xhttpSettings.extra = extra;
      }
      this.applyXhttpMaxConnections(streamSettings, perf.xhttpMaxConnections);
    }

    if (transport === 'mkcp') {
      streamSettings.kcpSettings = {
        mtu: 1350,
        tti: 20,
        uplinkCapacity: 50,
        downlinkCapacity: 100,
        congestion: true,
        readBufferSize: 4,
        writeBufferSize: 4,
        header: { type: 'none' },
      };
    }

    const finalmask = this.buildFinalmask(config, protocol);
    if (finalmask) {
      streamSettings.finalmask = finalmask;
    }

    const hasVisionFlow =
      protocol === 'vless' && !!(config.flow && config.flow.trim() !== '');
    const forceMux =
      protocol === 'trojan' && requiresPublicTrojanMux(config.address);
    const mux = this.buildMuxSettings(transport, hasVisionFlow, perf, {
      forceMux,
    });

    const outbound: XrayOutbound = {
      protocol,
      settings: this.buildOutboundSettings(config, protocol, hasVisionFlow),
      streamSettings: {
        ...streamSettings,
        sockopt: { tcpFastOpen: perf.tcpFastOpen },
      },
      mux,
      tag: 'proxy',
    };
    return outbound;
  }

  private static buildFinalmask(
    config: VlessConfig,
    protocol: StructuredOutboundProtocol,
  ): Record<string, unknown> | undefined {
    let finalmask: Record<string, unknown> | undefined = config.finalmask
      ? { ...config.finalmask }
      : undefined;

    const obfsType = (config.hysteriaObfs?.type || '').toLowerCase();
    const obfsPassword = config.hysteriaObfs?.password;
    if (protocol === 'hysteria' && obfsType === 'salamander' && obfsPassword) {
      const salamanderUdp = [
        { type: 'salamander', settings: { password: obfsPassword } },
      ];
      if (!finalmask) {
        finalmask = { udp: salamanderUdp };
      } else {
        const existingUdp = Array.isArray(finalmask.udp)
          ? (finalmask.udp as unknown[])
          : [];
        finalmask = { ...finalmask, udp: [...salamanderUdp, ...existingUdp] };
      }
    }

    return finalmask;
  }

  private static buildOutboundSettings(
    config: VlessConfig,
    protocol: Exclude<StructuredOutboundProtocol, 'wireguard'>,
    hasVisionFlow: boolean,
  ): Record<string, unknown> {
    if (protocol === 'hysteria') {
      return {
        version: 2,
        address: config.address,
        port: config.port,
      };
    }
    if (protocol === 'trojan') {
      return {
        address: config.address,
        port: config.port,
        password: config.password || '',
      };
    }
    if (protocol === 'vmess') {
      return {
        address: config.address,
        port: config.port,
        id: config.userId || config.uuid,
        security: normalizeVmessSecurity(config.vmessSecurity),
      };
    }
    if (protocol === 'shadowsocks') {
      const method = config.method || '';
      assertSupportedShadowsocksMethod(method);
      return {
        address: config.address,
        port: config.port,
        method,
        password: config.password || '',
      };
    }
    // Simplified VLESS outbound (current Project X docs); vnext is legacy.
    const settings: Record<string, unknown> = {
      address: config.address,
      port: config.port,
      id: config.userId || config.uuid,
      encryption: config.encryption || 'none',
    };
    if (hasVisionFlow && config.flow) {
      settings.flow = config.flow;
    }
    return settings;
  }

  /**
   * Apply the user-facing XHTTP xmux.maxConnections knob.
   * Clears maxConcurrency when present — Xray rejects both together.
   */
  private static applyXhttpMaxConnections(
    streamSettings: MutableStreamSettings | XrayStreamSettings,
    maxConnections: number,
  ): void {
    const mutable = streamSettings as MutableStreamSettings;
    const transport = mutable.method ?? mutable.network;
    const xhttpKey = mutable.xhttpSettings
      ? 'xhttpSettings'
      : mutable.splithttpSettings
        ? 'splithttpSettings'
        : null;
    if (!xhttpKey) {
      if (transport !== 'xhttp' && transport !== 'splithttp') return;
      return;
    }
    const xhttp = mutable[xhttpKey];
    if (!xhttp || typeof xhttp !== 'object' || Array.isArray(xhttp)) return;

    const existingExtra =
      xhttp.extra &&
      typeof xhttp.extra === 'object' &&
      !Array.isArray(xhttp.extra)
        ? (xhttp.extra as MutableConfigNode)
        : {};
    const existingXmux =
      existingExtra.xmux &&
      typeof existingExtra.xmux === 'object' &&
      !Array.isArray(existingExtra.xmux)
        ? { ...(existingExtra.xmux as MutableConfigNode) }
        : {};

    delete existingXmux.maxConcurrency;
    existingXmux.maxConnections = maxConnections;
    xhttp.extra = { ...existingExtra, xmux: existingXmux };
  }

  private static buildMuxSettings(
    transport: unknown,
    hasVisionFlow: boolean,
    perf: PerformanceSettings,
    options: { forceMux?: boolean } = {},
  ): XrayMuxSettings {
    if (transport === 'grpc' || transport === 'hysteria') {
      return { enabled: false };
    }
    if (hasVisionFlow) {
      // Vision + XUDP mux makes TUN DNS (and the first REALITY dial) wait on
      // the mux client. Disable mux entirely for Vision outbounds.
      return { enabled: false };
    }
    return {
      enabled: options.forceMux === true ? true : perf.muxEnabled,
      concurrency: perf.muxConcurrency,
      xudpConcurrency: perf.xudpConcurrency,
      xudpProxyUDP443: perf.xudpProxyUDP443,
    };
  }

  private static applySendThroughIfNeeded(
    cfg: XrayConfig,
    sendThrough?: string,
  ): void {
    if (
      !sendThrough ||
      !Array.isArray(cfg.outbounds) ||
      cfg.outbounds.length === 0
    ) {
      return;
    }
    // Pin both proxy and freedom/direct. Direct without a physical bind loops
    // into TUN whenever routing sends geoip:private there.
    const outbounds = cfg.outbounds as MutableOutbound[];
    for (const outbound of outbounds) {
      if (!outbound || outbound.sendThrough) continue;
      if (
        outbound.tag === 'proxy' ||
        outbound.tag === 'direct' ||
        outbound.protocol === 'freedom'
      ) {
        outbound.sendThrough = sendThrough;
      }
    }
  }
}

