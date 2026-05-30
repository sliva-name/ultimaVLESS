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
import { buildDefaultRoutingRules } from './configGenerator/routing';
import { applyStatsApi } from './configGenerator/statsApi';

type MutableConfigNode = Record<string, unknown>;

type MutableSockopt = MutableConfigNode & { tcpFastOpen?: boolean };
type MutableStreamSettings = MutableConfigNode & { sockopt?: MutableSockopt };
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
  | 'shadowsocks';

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
      this.applySendThroughIfNeeded(cfg, options.sendThrough);
    }

    // Raw subscriptions often omit the `block` / `direct` outbounds that are
    // mandatory once routing rules reference them (either from the raw config
    // itself or from the ad/bittorrent blockers injected below). Xray refuses
    // to start with "outboundTag not found" otherwise.
    this.ensureAuxiliaryOutbounds(cfg);
    this.applyPerfToOutbounds(cfg, perf);
    this.applyPerfToRouting(cfg, perf);
    applyStatsApi(cfg);

    return cfg;
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

      if (!outbound.streamSettings) outbound.streamSettings = {};
      this.normalizeStreamSettings(outbound.streamSettings);
      if (!outbound.streamSettings.sockopt) {
        outbound.streamSettings.sockopt = { tcpFastOpen: perf.tcpFastOpen };
      } else if (outbound.streamSettings.sockopt.tcpFastOpen === undefined) {
        outbound.streamSettings.sockopt.tcpFastOpen = perf.tcpFastOpen;
      }

      if (!outbound.mux) {
        const hasVisionFlow = this.outboundHasVisionFlow(outbound);
        outbound.mux = this.buildMuxSettings(
          outbound.streamSettings.network,
          hasVisionFlow,
          perf,
        );
      }
    }
  }

  private static isTunableProxyProtocol(protocol: unknown): boolean {
    return (
      protocol === 'vless' ||
      protocol === 'vmess' ||
      protocol === 'trojan' ||
      protocol === 'shadowsocks'
    );
  }

  private static normalizeStreamSettings(
    streamSettings: MutableStreamSettings,
  ): void {
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
    const vnext = settings?.vnext;
    if (!Array.isArray(vnext)) return false;
    for (const server of vnext) {
      if (!Array.isArray(server.users)) continue;
      for (const user of server.users as Array<Record<string, unknown>>) {
        if (
          user.flow &&
          typeof user.flow === 'string' &&
          user.flow.trim() !== ''
        )
          return true;
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
    return 'vless';
  }

  private static normalizeTransport(
    config: VlessConfig,
  ): XrayStreamSettings['network'] {
    const transport = config.type || 'tcp';
    switch (transport) {
      case 'raw':
      case 'tcp':
        return 'tcp';
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
      case 'http':
        throw new Error(
          `HTTP transport is not supported by bundled Xray ${BUNDLED_XRAY_VERSION}; use XHTTP instead.`,
        );
      case 'quic':
        throw new Error(
          `QUIC transport is not supported by bundled Xray ${BUNDLED_XRAY_VERSION}; use XHTTP/H3 instead.`,
        );
      default:
        return 'tcp';
    }
  }

  private static getDefaultSecurity(
    config: VlessConfig,
    protocol: StructuredOutboundProtocol,
  ): XrayStreamSettings['security'] {
    if (config.security) return config.security;
    return protocol === 'trojan' ? 'tls' : 'none';
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

    const streamSettings: XrayStreamSettings = {
      network: this.normalizeTransport(config),
      security: this.getDefaultSecurity(config, protocol),
    };
    if (
      streamSettings.security === 'reality' &&
      !['tcp', 'xhttp', 'grpc'].includes(streamSettings.network)
    ) {
      throw new Error('REALITY transport requires RAW/TCP, XHTTP, or gRPC.');
    }

    const defaultFp = perf.fingerprint;

    if (streamSettings.security === 'reality') {
      streamSettings.realitySettings = {
        fingerprint: config.fp || defaultFp,
        serverName: config.sni || '',
        password: config.pbk || '',
        shortId: config.sid || '',
        spiderX: config.spx || '',
      };
    } else if (streamSettings.security === 'tls') {
      streamSettings.tlsSettings = {
        serverName: config.sni || '',
        allowInsecure: !!config.allowInsecure,
        alpn: ['h2', 'http/1.1'],
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
    }

    if (streamSettings.network === 'websocket') {
      streamSettings.wsSettings = {
        path: this.withWebSocketEarlyData(
          config.path || '/',
          config.wsMaxEarlyData,
        ),
        host: config.host || config.sni || '',
      };
    }

    if (streamSettings.network === 'httpupgrade') {
      streamSettings.httpupgradeSettings = {
        path: this.withWebSocketEarlyData(
          config.path || '/',
          config.wsMaxEarlyData,
        ),
        host: config.host || config.sni || '',
      } as Record<string, unknown>;
    }

    if (streamSettings.network === 'grpc') {
      streamSettings.grpcSettings = {
        serviceName: config.serviceName || '',
      };
    }

    if (streamSettings.network === 'xhttp') {
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
    }

    if (streamSettings.network === 'mkcp') {
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

    const hasVisionFlow =
      protocol === 'vless' && !!(config.flow && config.flow.trim() !== '');
    const mux = this.buildMuxSettings(
      streamSettings.network,
      hasVisionFlow,
      perf,
    );

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
    if (connectionMode === 'tun' && options.sendThrough) {
      outbound.sendThrough = options.sendThrough;
    }

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
        servers: [
          '1.1.1.1',
          '1.0.0.1',
          {
            address: '223.5.5.5',
            domains: ['geosite:cn'],
            expectIPs: ['geoip:cn'],
          },
          'localhost',
        ],
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

    applyStatsApi(cfg);
    return cfg;
  }

  private static buildOutboundSettings(
    config: VlessConfig,
    protocol: StructuredOutboundProtocol,
    hasVisionFlow: boolean,
  ): Record<string, unknown> {
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
        security: config.vmessSecurity || 'auto',
      };
    }
    if (protocol === 'shadowsocks') {
      return {
        address: config.address,
        port: config.port,
        method: config.method || '',
        password: config.password || '',
      };
    }
    const vlessUser: { id: string; encryption: string; flow?: string } = {
      id: config.userId || config.uuid,
      encryption: config.encryption || 'none',
    };
    if (hasVisionFlow && config.flow) {
      vlessUser.flow = config.flow;
    }
    return {
      vnext: [
        {
          address: config.address,
          port: config.port,
          users: [vlessUser],
        },
      ],
    };
  }

  private static buildMuxSettings(
    network: unknown,
    hasVisionFlow: boolean,
    perf: PerformanceSettings,
  ): XrayMuxSettings {
    if (network === 'grpc') {
      return { enabled: false };
    }
    if (hasVisionFlow) {
      return {
        enabled: true,
        concurrency: -1,
        xudpConcurrency: perf.xudpConcurrency,
        xudpProxyUDP443: perf.xudpProxyUDP443,
      };
    }
    return {
      enabled: perf.muxEnabled,
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
    const outbounds = cfg.outbounds as MutableOutbound[];
    const preferred =
      outbounds.find((outbound) => outbound?.tag === 'proxy') ?? outbounds[0];
    if (!preferred || preferred.sendThrough) {
      return;
    }
    preferred.sendThrough = sendThrough;
  }
}

