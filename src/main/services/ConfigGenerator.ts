import { ConnectionMode, DEFAULT_PERFORMANCE_SETTINGS, PerformanceSettings, VlessConfig } from '../../shared/types';
import { XrayConfig, XrayOutbound, XrayInbound, XrayStreamSettings, XrayMuxSettings, XrayRoutingRule } from '../../shared/xray-types';
import { APP_CONSTANTS } from '../../shared/constants';

type MutableConfigNode = Record<string, any>;
type MutableInbound = MutableConfigNode & { protocol?: string; tag?: string };
type MutableOutbound = MutableConfigNode & { protocol?: string; tag?: string };

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
    options: ConfigGeneratorOptions = {}
  ): XrayConfig {
    if (config.rawConfig) {
      return this.applyRawConfig(config.rawConfig, logPath, connectionMode, options);
    }
    return this.generateFromFields(config, logPath, connectionMode, options);
  }

  private static applyRawConfig(
    rawConfig: XrayConfig,
    logPath: string,
    connectionMode: ConnectionMode,
    options: ConfigGeneratorOptions
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
    const hasTun = cfg.inbounds.some((ib) => ib?.protocol === 'tun' || ib?.tag === 'tun-in');

    if (connectionMode === 'tun' && !hasTun) {
      cfg.inbounds.unshift(this.createTunInbound(options));
      this.applySendThroughIfNeeded(cfg, options.sendThrough);
    }

    this.applyPerfToOutbounds(cfg, perf);
    this.applyPerfToRouting(cfg, perf);

    return cfg;
  }

  private static applyPerfToOutbounds(cfg: XrayConfig, perf: PerformanceSettings): void {
    if (!Array.isArray(cfg.outbounds)) return;
    for (const outbound of cfg.outbounds as MutableOutbound[]) {
      if (!outbound || (outbound.tag && outbound.tag !== 'proxy')) continue;
      if (outbound.protocol !== 'vless' && outbound.protocol !== 'trojan') continue;

      if (!outbound.streamSettings) outbound.streamSettings = {};
      if (!outbound.streamSettings.sockopt) {
        outbound.streamSettings.sockopt = { tcpFastOpen: perf.tcpFastOpen };
      } else if (outbound.streamSettings.sockopt.tcpFastOpen === undefined) {
        outbound.streamSettings.sockopt.tcpFastOpen = perf.tcpFastOpen;
      }

      if (!outbound.mux) {
        const hasVisionFlow = this.outboundHasVisionFlow(outbound);
        outbound.mux = hasVisionFlow
          ? { enabled: true, concurrency: -1, xudpConcurrency: perf.xudpConcurrency, xudpProxyUDP443: perf.xudpProxyUDP443 }
          : { enabled: perf.muxEnabled, concurrency: perf.muxConcurrency, xudpConcurrency: perf.xudpConcurrency, xudpProxyUDP443: perf.xudpProxyUDP443 };
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
        if (user.flow && typeof user.flow === 'string' && user.flow.trim() !== '') return true;
      }
    }
    return false;
  }

  private static applyPerfToRouting(cfg: XrayConfig, perf: PerformanceSettings): void {
    if (!cfg.routing || typeof cfg.routing !== 'object') {
      cfg.routing = { domainStrategy: perf.domainStrategy, rules: [] };
    }

    const rules: Array<Record<string, any>> = Array.isArray(cfg.routing.rules) ? cfg.routing.rules : [];

    const hasAdBlock = rules.some((r) =>
      Array.isArray(r.domain) && r.domain.some((d: unknown) => typeof d === 'string' && d.includes('category-ads'))
    );
    if (perf.blockAds && !hasAdBlock) {
      rules.unshift({ type: 'field', domain: ['geosite:category-ads-all'], outboundTag: 'block' });
    }

    const hasBtBlock = rules.some((r) =>
      Array.isArray(r.protocol) && r.protocol.includes('bittorrent') && r.outboundTag === 'block'
    );
    if (perf.blockBittorrent && !hasBtBlock) {
      const btIndex = rules.findIndex((r) =>
        Array.isArray(r.protocol) && r.protocol.includes('bittorrent')
      );
      if (btIndex >= 0) {
        rules[btIndex].outboundTag = 'block';
      } else {
        const insertIdx = hasAdBlock || (perf.blockAds && !hasAdBlock) ? 1 : 0;
        rules.splice(insertIdx, 0, { type: 'field', protocol: ['bittorrent'], outboundTag: 'block' });
      }
    }

    cfg.routing.rules = rules as XrayRoutingRule[];
  }

  private static generateFromFields(
    config: VlessConfig,
    logPath: string,
    connectionMode: ConnectionMode,
    options: ConfigGeneratorOptions
  ): XrayConfig {
    const perf = options.performanceSettings ?? DEFAULT_PERFORMANCE_SETTINGS;

    const streamSettings: XrayStreamSettings = {
      network: (config.type === 'raw' ? 'raw' : config.type) || 'tcp',
      security: config.security || 'none',
    };

    const defaultFp = perf.fingerprint;

    if (config.security === 'reality') {
      streamSettings.realitySettings = {
        fingerprint: config.fp || defaultFp,
        serverName: config.sni || '',
        password: config.pbk || '',
        shortId: config.sid || '',
        spiderX: config.spx || '',
      };
    } else if (config.security === 'tls') {
      streamSettings.tlsSettings = {
        serverName: config.sni || '',
        allowInsecure: false,
        alpn: ['h2', 'http/1.1'],
        fingerprint: config.fp || defaultFp,
      };
    }

    if (config.type === 'ws') {
      streamSettings.wsSettings = {
        path: config.path || '/',
        headers: { Host: config.host || config.sni || '' },
      };
    }

    if (config.type === 'grpc') {
      streamSettings.grpcSettings = {
        serviceName: config.serviceName || '',
      };
    }

    if (config.type === 'kcp') {
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

    if (config.type === 'http') {
      const h = (config.host || config.sni || '').trim();
      streamSettings.httpSettings = {
        path: config.path || '/',
        host: h ? [h] : [],
      };
    }

    if (config.type === 'quic') {
      streamSettings.quicSettings = {
        security: 'none',
        key: '',
        header: { type: 'none' },
      };
    }

    const vlessUser: { id: string; encryption: string; flow?: string } = {
      id: config.userId || config.uuid,
      encryption: config.encryption || 'none',
    };
    const hasVisionFlow = !!(config.flow && config.flow.trim() !== '');
    if (hasVisionFlow) {
      vlessUser.flow = config.flow;
    }

    const mux: XrayMuxSettings = hasVisionFlow
      ? { enabled: true, concurrency: -1, xudpConcurrency: perf.xudpConcurrency, xudpProxyUDP443: perf.xudpProxyUDP443 }
      : { enabled: perf.muxEnabled, concurrency: perf.muxConcurrency, xudpConcurrency: perf.xudpConcurrency, xudpProxyUDP443: perf.xudpProxyUDP443 };

    const outbound: XrayOutbound = {
      protocol: 'vless',
      settings: {
        vnext: [
          {
            address: config.address,
            port: config.port,
            users: [vlessUser],
          },
        ],
      },
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

    const inbounds: XrayInbound[] = this.createLocalProxyInbounds(perf.sniffingRouteOnly);
    if (connectionMode === 'tun') {
      inbounds.unshift(this.createTunInbound(options) as XrayInbound);
    }

    return {
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
            expectIPs: ['geoip:cn']
          },
          'localhost'
        ],
        queryStrategy: 'UseIPv4',
      },
      inbounds,
      outbounds: [
        outbound,
        { protocol: 'freedom', tag: 'direct' },
        { protocol: 'blackhole', tag: 'block' },
      ],
      routing: {
        domainStrategy: perf.domainStrategy,
        rules: this.buildRoutingRules(perf),
      },
    };
  }

  private static applySendThroughIfNeeded(cfg: XrayConfig, sendThrough?: string): void {
    if (!sendThrough || !Array.isArray(cfg.outbounds) || cfg.outbounds.length === 0) {
      return;
    }
    const outbounds = cfg.outbounds as MutableOutbound[];
    const preferred =
      outbounds.find((outbound) => outbound?.tag === 'proxy') ??
      outbounds[0];
    if (!preferred || preferred.sendThrough) {
      return;
    }
    preferred.sendThrough = sendThrough;
  }

  private static createLocalProxyInbounds(sniffingRouteOnly = true): XrayInbound[] {
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

  private static ensureLocalProxyInbounds(inbounds: MutableInbound[], sniffingRouteOnly = true): void {
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

  private static buildRoutingRules(perf: PerformanceSettings): XrayRoutingRule[] {
    const rules: XrayRoutingRule[] = [];
    if (perf.blockAds) {
      rules.push({ type: 'field', domain: ['geosite:category-ads-all'], outboundTag: 'block' });
    }
    if (perf.blockBittorrent) {
      rules.push({ type: 'field', protocol: ['bittorrent'], outboundTag: 'block' });
    }
    rules.push(
      { type: 'field', domain: ['geosite:cn'], outboundTag: 'direct' },
      { type: 'field', ip: ['geoip:private', 'geoip:cn'], outboundTag: 'direct' },
      { type: 'field', port: '0-65535', outboundTag: 'proxy' },
    );
    return rules;
  }

  private static createTunInbound(options: ConfigGeneratorOptions): XrayInbound {
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
