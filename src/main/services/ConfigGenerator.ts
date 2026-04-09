import { ConnectionMode, VlessConfig } from '../../shared/types';
import { XrayConfig, XrayOutbound, XrayInbound, XrayStreamSettings } from '../../shared/xray-types';
import { APP_CONSTANTS } from '../../shared/constants';

export interface ConfigGeneratorOptions {
  sendThrough?: string;
  tunAutoRoute?: boolean;
}

export class ConfigGenerator {
  static generate(
    config: VlessConfig,
    logPath: string,
    connectionMode: ConnectionMode = 'proxy',
    options: ConfigGeneratorOptions = {}
  ): any {
    if (config.rawConfig) {
      return this.applyRawConfig(config.rawConfig, logPath, connectionMode, options);
    }
    return this.generateFromFields(config, logPath, connectionMode, options);
  }

  private static applyRawConfig(
    rawConfig: Record<string, any>,
    logPath: string,
    connectionMode: ConnectionMode,
    options: ConfigGeneratorOptions
  ): any {
    const cfg = JSON.parse(JSON.stringify(rawConfig));

    cfg.log = {
      loglevel: APP_CONSTANTS.DEFAULTS.LOG_LEVEL,
      access: logPath,
      error: logPath,
    };

    if (!cfg.inbounds || !Array.isArray(cfg.inbounds)) {
      cfg.inbounds = [];
    }

    this.ensureLocalProxyInbounds(cfg.inbounds);
    const hasTun = cfg.inbounds.some((ib: any) => ib?.protocol === 'tun' || ib?.tag === 'tun-in');

    if (connectionMode === 'tun' && !hasTun) {
      cfg.inbounds.unshift(this.createTunInbound(options));
      this.applySendThroughIfNeeded(cfg, options.sendThrough);
    }

    return cfg;
  }

  private static generateFromFields(
    config: VlessConfig,
    logPath: string,
    connectionMode: ConnectionMode,
    options: ConfigGeneratorOptions
  ): XrayConfig {
    const streamSettings: XrayStreamSettings = {
      // Xray 1.8+ renamed 'tcp' to 'raw'; both are accepted but 'raw' is canonical.
      network: (config.type === 'raw' ? 'raw' : config.type) || 'tcp',
      security: config.security || 'none',
    };

    if (config.security === 'reality') {
      // Per xray-docs-next REALITY client: public key goes in `password`, not `publicKey`.
      streamSettings.realitySettings = {
        fingerprint: config.fp || APP_CONSTANTS.DEFAULTS.FINGERPRINT,
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
        ...(config.fp ? { fingerprint: config.fp } : {}),
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
        tti: 50,
        uplinkCapacity: 12,
        downlinkCapacity: 100,
        congestion: false,
        readBufferSize: 2,
        writeBufferSize: 2,
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
    if (config.flow && config.flow.trim() !== '') {
      vlessUser.flow = config.flow;
    }

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
        mux: {
          enabled: true,
          concurrency: 8,
          xudpConcurrency: 16,
          xudpProxyUDP443: 'reject'
        }
      },
      tag: 'proxy',
    };
    if (connectionMode === 'tun' && options.sendThrough) {
      outbound.sendThrough = options.sendThrough;
    }

    const inbounds: XrayInbound[] = this.createLocalProxyInbounds();
    if (connectionMode === 'tun') {
      inbounds.unshift(this.createTunInbound(options) as XrayInbound);
    }

    return {
      log: {
        loglevel: APP_CONSTANTS.DEFAULTS.LOG_LEVEL,
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
        domainStrategy: 'IPIfNonMatch',
        rules: [
          { type: 'field', domain: ['geosite:category-ads-all'], outboundTag: 'block' },
          { type: 'field', protocol: ['bittorrent'], outboundTag: 'block' },
          { type: 'field', domain: ['geosite:cn'], outboundTag: 'direct' },
          { type: 'field', ip: ['geoip:private', 'geoip:cn'], outboundTag: 'direct' },
          { type: 'field', port: '0-65535', outboundTag: 'proxy' },
        ],
      },
    };
  }

  private static applySendThroughIfNeeded(cfg: Record<string, any>, sendThrough?: string): void {
    if (!sendThrough || !Array.isArray(cfg.outbounds) || cfg.outbounds.length === 0) {
      return;
    }
    const outbounds = cfg.outbounds as Array<Record<string, any>>;
    const preferred =
      outbounds.find((outbound) => outbound?.tag === 'proxy') ??
      outbounds[0];
    if (!preferred || preferred.sendThrough) {
      return;
    }
    preferred.sendThrough = sendThrough;
  }

  private static createLocalProxyInbounds(): XrayInbound[] {
    return [
      {
        tag: 'socks',
        port: APP_CONSTANTS.PORTS.SOCKS,
        listen: '127.0.0.1',
        protocol: 'socks',
        settings: {
          udp: true,
        },
        sniffing: {
          enabled: true,
          destOverride: ['http', 'tls', 'quic'],
        },
      },
      {
        tag: 'http',
        port: APP_CONSTANTS.PORTS.HTTP,
        listen: '127.0.0.1',
        protocol: 'http',
        settings: {},
      },
    ];
  }

  private static ensureLocalProxyInbounds(inbounds: Array<Record<string, any>>): void {
    let hasSocks = false;
    let hasHttp = false;

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
        inbound.sniffing = inbound.sniffing ?? {
          enabled: true,
          destOverride: ['http', 'tls', 'quic'],
        };
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
        inbound.sniffing = inbound.sniffing ?? {
          enabled: true,
          destOverride: ['http', 'tls', 'quic'],
        };
        hasHttp = true;
      }
    }

    if (!hasSocks || !hasHttp) {
      const defaults = this.createLocalProxyInbounds();
      if (!hasSocks) {
        inbounds.push(defaults[0] as Record<string, any>);
      }
      if (!hasHttp) {
        inbounds.push(defaults[1] as Record<string, any>);
      }
    }
  }

  private static createTunInbound(options: ConfigGeneratorOptions): Record<string, any> {
    const tunInbound: Record<string, any> = {
      tag: 'tun-in',
      port: 0,
      protocol: 'tun' as any,
      settings: {
        name: 'ultima0',
        mtu: 1500,
        inet4_address: '172.19.0.1/30',
      },
    };
    if (options.tunAutoRoute) {
      tunInbound.settings.autoRoute = true;
      tunInbound.settings.strictRoute = true;
    }
    return tunInbound;
  }
}
