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
import { APP_CONSTANTS } from '@/shared/constants';

type MutableConfigNode = Record<string, unknown>;

type MutableSockopt = MutableConfigNode & { tcpFastOpen?: boolean };
type MutableStreamSettings = MutableConfigNode & { sockopt?: MutableSockopt };
type MutableSniffing = MutableConfigNode & {
  enabled?: boolean;
  destOverride?: string[];
  routeOnly?: boolean;
};

type MutableInbound = MutableConfigNode & {
  protocol?: string;
  tag?: string;
  port?: number;
  listen?: string;
  settings?: MutableConfigNode;
  sniffing?: MutableSniffing;
};

type MutableOutbound = MutableConfigNode & {
  protocol?: string;
  tag?: string;
  settings?: MutableConfigNode;
  streamSettings?: MutableStreamSettings;
  mux?: MutableConfigNode;
};

export interface ConfigGeneratorOptions {
  sendThrough?: string;
  tunAutoRoute?: boolean;
  performanceSettings?: PerformanceSettings;
}

export class ConfigGenerator {
  static generate(
    config: VlessConfig,
    logPath: string,
    connectionMode: ConnectionMode = 'proxy',
    options: ConfigGeneratorOptions = {},
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
    options: ConfigGeneratorOptions,
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

    this.ensureLocalProxyInbounds(cfg.inbounds, perf.sniffingRouteOnly);
    const hasTun = cfg.inbounds.some(
      (ib) => ib?.protocol === 'tun' || ib?.tag === 'tun-in',
    );

    if (connectionMode === 'tun' && !hasTun) {
      cfg.inbounds.unshift(this.createTunInbound(options));
      this.applySendThroughIfNeeded(cfg, options.sendThrough);
    }

    // Raw subscriptions often omit the `block` / `direct` outbounds that are
    // mandatory once routing rules reference them (either from the raw config
    // itself or from the ad/bittorrent blockers injected below). Xray refuses
    // to start with "outboundTag not found" otherwise.
    this.ensureAuxiliaryOutbounds(cfg);
    this.applyPerfToOutbounds(cfg, perf);
    this.applyPerfToRouting(cfg, perf);
    this.applyStatsApi(cfg);

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
      if (outbound.protocol !== 'vless' && outbound.protocol !== 'trojan')
        continue;

      if (!outbound.streamSettings) outbound.streamSettings = {};
      if (!outbound.streamSettings.sockopt) {
        outbound.streamSettings.sockopt = { tcpFastOpen: perf.tcpFastOpen };
      } else if (outbound.streamSettings.sockopt.tcpFastOpen === undefined) {
        outbound.streamSettings.sockopt.tcpFastOpen = perf.tcpFastOpen;
      }

      if (!outbound.mux) {
        const hasVisionFlow = this.outboundHasVisionFlow(outbound);
        outbound.mux = hasVisionFlow
          ? {
              enabled: true,
              concurrency: -1,
              xudpConcurrency: perf.xudpConcurrency,
              xudpProxyUDP443: perf.xudpProxyUDP443,
            }
          : {
              enabled: perf.muxEnabled,
              concurrency: perf.muxConcurrency,
              xudpConcurrency: perf.xudpConcurrency,
              xudpProxyUDP443: perf.xudpProxyUDP443,
            };
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

    cfg.routing.rules = rules as XrayRoutingRule[];
  }

  private static generateFromFields(
    config: VlessConfig,
    logPath: string,
    connectionMode: ConnectionMode,
    options: ConfigGeneratorOptions,
  ): XrayConfig {
    const perf = options.performanceSettings ?? DEFAULT_PERFORMANCE_SETTINGS;
    const protocol: 'vless' | 'trojan' =
      config.protocol === 'trojan' ? 'trojan' : 'vless';

    const streamSettings: XrayStreamSettings = {
      network: (config.type === 'raw' ? 'raw' : config.type) || 'tcp',
      security: config.security || (protocol === 'trojan' ? 'tls' : 'none'),
    };

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
    }

    if (streamSettings.network === 'ws') {
      streamSettings.wsSettings = {
        path: config.path || '/',
        headers: { Host: config.host || config.sni || '' },
      };
    }

    if (streamSettings.network === 'grpc') {
      streamSettings.grpcSettings = {
        serviceName: config.serviceName || '',
      };
    }

    if (streamSettings.network === 'kcp') {
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

    if (streamSettings.network === 'http') {
      const h = (config.host || config.sni || '').trim();
      streamSettings.httpSettings = {
        path: config.path || '/',
        host: h ? [h] : [],
      };
    }

    if (streamSettings.network === 'quic') {
      streamSettings.quicSettings = {
        security: 'none',
        key: '',
        header: { type: 'none' },
      };
    }

    const hasVisionFlow =
      protocol === 'vless' && !!(config.flow && config.flow.trim() !== '');
    const mux: XrayMuxSettings = hasVisionFlow
      ? {
          enabled: true,
          concurrency: -1,
          xudpConcurrency: perf.xudpConcurrency,
          xudpProxyUDP443: perf.xudpProxyUDP443,
        }
      : {
          enabled: perf.muxEnabled,
          concurrency: perf.muxConcurrency,
          xudpConcurrency: perf.xudpConcurrency,
          xudpProxyUDP443: perf.xudpProxyUDP443,
        };

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

    const inbounds: XrayInbound[] = this.createLocalProxyInbounds(
      perf.sniffingRouteOnly,
    );
    if (connectionMode === 'tun') {
      inbounds.unshift(this.createTunInbound(options) as XrayInbound);
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
        rules: this.buildRoutingRules(perf),
      },
    };

    this.applyStatsApi(cfg);
    return cfg;
  }

  /**
   * Enables Xray's StatsService on a loopback gRPC port so the renderer can
   * display per-session upload/download counters. Adds the matching `api`
   * inbound, routing rule, policy counters, and outbound stub.
   */
  private static applyStatsApi(cfg: XrayConfig): void {
    cfg.stats = cfg.stats ?? {};
    cfg.api = cfg.api ?? { tag: 'api', services: ['StatsService'] };

    const policy = (cfg.policy ?? {}) as Record<string, unknown>;
    const levels =
      (policy.levels as Record<string, Record<string, unknown>>) ?? {};
    const levelZero = levels['0'] ?? {};
    levels['0'] = {
      ...levelZero,
      statsUserUplink: true,
      statsUserDownlink: true,
    };
    const system = (policy.system as Record<string, unknown>) ?? {};
    policy.levels = levels;
    policy.system = {
      ...system,
      statsInboundUplink: true,
      statsInboundDownlink: true,
      statsOutboundUplink: true,
      statsOutboundDownlink: true,
    };
    cfg.policy = policy;

    if (!Array.isArray(cfg.inbounds)) {
      cfg.inbounds = [];
    }
    const inbounds = cfg.inbounds as MutableInbound[];
    if (!inbounds.some((ib) => ib?.tag === 'api')) {
      inbounds.push({
        tag: 'api',
        port: APP_CONSTANTS.PORTS.API,
        listen: '127.0.0.1',
        protocol: 'dokodemo-door',
        settings: { address: '127.0.0.1' },
      });
    }

    if (!Array.isArray(cfg.outbounds)) cfg.outbounds = [];
    const outbounds = cfg.outbounds as MutableOutbound[];
    if (!outbounds.some((o) => o?.tag === 'api')) {
      outbounds.push({ tag: 'api', protocol: 'freedom', settings: {} });
    }

    if (!cfg.routing || typeof cfg.routing !== 'object') {
      cfg.routing = { domainStrategy: 'AsIs', rules: [] };
    }
    if (!Array.isArray(cfg.routing.rules)) {
      cfg.routing.rules = [];
    }
    const rules = cfg.routing.rules as XrayRoutingRule[];
    const hasApiRule = rules.some(
      (r) => r && Array.isArray(r.inboundTag) && r.inboundTag.includes('api'),
    );
    if (!hasApiRule) {
      // Append at the end: the api rule only matches the dedicated `api`
      // inbound, so it never competes with user rules and preserving the
      // original ordering keeps ad/bittorrent blockers as the first match.
      rules.push({ type: 'field', inboundTag: ['api'], outboundTag: 'api' });
    }
  }

  private static buildOutboundSettings(
    config: VlessConfig,
    protocol: 'vless' | 'trojan',
    hasVisionFlow: boolean,
  ): Record<string, unknown> {
    if (protocol === 'trojan') {
      const server: Record<string, unknown> = {
        address: config.address,
        port: config.port,
        password: config.password || '',
      };
      return { servers: [server] };
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

  private static createLocalProxyInbounds(
    sniffingRouteOnly = true,
  ): XrayInbound[] {
    const sniffing = {
      enabled: true,
      destOverride: ['http', 'tls', 'quic'],
      routeOnly: sniffingRouteOnly,
    };
    return [
      {
        tag: 'socks',
        port: APP_CONSTANTS.PORTS.SOCKS,
        listen: '127.0.0.1',
        protocol: 'socks',
        settings: { udp: true },
        sniffing,
      },
      {
        tag: 'http',
        port: APP_CONSTANTS.PORTS.HTTP,
        listen: '127.0.0.1',
        protocol: 'http',
        settings: {},
        sniffing,
      },
    ];
  }

  private static ensureLocalProxyInbounds(
    inbounds: MutableInbound[],
    sniffingRouteOnly = true,
  ): void {
    let hasSocks = false;
    let hasHttp = false;

    const ensureSniffing = (inbound: MutableInbound) => {
      if (!inbound.sniffing) {
        inbound.sniffing = {
          enabled: true,
          destOverride: ['http', 'tls', 'quic'],
          routeOnly: sniffingRouteOnly,
        };
      } else {
        inbound.sniffing.routeOnly = sniffingRouteOnly;
      }
    };

    for (const inbound of inbounds) {
      if (inbound.protocol === 'socks') {
        inbound.tag ??= 'socks';
        inbound.port = APP_CONSTANTS.PORTS.SOCKS;
        inbound.listen = '127.0.0.1';
        inbound.settings = {
          auth: 'noauth',
          ...inbound.settings,
          udp: true,
        };
        ensureSniffing(inbound);
        hasSocks = true;
      }
      if (inbound.protocol === 'http') {
        inbound.tag ??= 'http';
        inbound.port = APP_CONSTANTS.PORTS.HTTP;
        inbound.listen = '127.0.0.1';
        inbound.settings = {
          allowTransparent: false,
          ...inbound.settings,
        };
        ensureSniffing(inbound);
        hasHttp = true;
      }
    }

    if (!hasSocks || !hasHttp) {
      const defaults = this.createLocalProxyInbounds(sniffingRouteOnly);
      if (!hasSocks) {
        inbounds.push(defaults[0] as MutableInbound);
      }
      if (!hasHttp) {
        inbounds.push(defaults[1] as MutableInbound);
      }
    }
  }

  private static buildRoutingRules(
    perf: PerformanceSettings,
  ): XrayRoutingRule[] {
    const rules: XrayRoutingRule[] = [];
    if (perf.blockAds) {
      rules.push({
        type: 'field',
        domain: ['geosite:category-ads-all'],
        outboundTag: 'block',
      });
    }
    if (perf.blockBittorrent) {
      rules.push({
        type: 'field',
        protocol: ['bittorrent'],
        outboundTag: 'block',
      });
    }
    rules.push(
      { type: 'field', domain: ['geosite:cn'], outboundTag: 'direct' },
      {
        type: 'field',
        ip: ['geoip:private', 'geoip:cn'],
        outboundTag: 'direct',
      },
      { type: 'field', port: '0-65535', outboundTag: 'proxy' },
    );
    return rules;
  }

  private static createTunInbound(
    options: ConfigGeneratorOptions,
  ): XrayInbound {
    const tunInbound: XrayInbound = {
      tag: 'tun-in',
      port: 0,
      protocol: 'tun',
      settings: {
        name: 'ultima0',
        mtu: 1500,
        inet4_address: '172.19.0.1/30',
      },
    };
    if (options.tunAutoRoute) {
      (tunInbound.settings as MutableConfigNode).autoRoute = true;
      (tunInbound.settings as MutableConfigNode).strictRoute = true;
    }
    return tunInbound;
  }
}
