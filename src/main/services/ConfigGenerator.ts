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

    const hasSocks = cfg.inbounds.some((ib: any) => ib.protocol === 'socks');
    const hasHttp = cfg.inbounds.some((ib: any) => ib.protocol === 'http');
    const hasTun = cfg.inbounds.some((ib: any) => ib?.protocol === 'tun' || ib?.tag === 'tun-in');

    for (const ib of cfg.inbounds) {
      if (ib.protocol === 'socks') {
        ib.port = APP_CONSTANTS.PORTS.SOCKS;
        ib.listen = '127.0.0.1';
      }
      if (ib.protocol === 'http') {
        ib.port = APP_CONSTANTS.PORTS.HTTP;
        ib.listen = '127.0.0.1';
      }
    }

    if (!hasSocks) {
      cfg.inbounds.push({
        tag: 'socks',
        port: APP_CONSTANTS.PORTS.SOCKS,
        listen: '127.0.0.1',
        protocol: 'socks',
        settings: { udp: true, auth: 'noauth' },
        sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
      });
    }

    if (!hasHttp) {
      cfg.inbounds.push({
        tag: 'http',
        port: APP_CONSTANTS.PORTS.HTTP,
        listen: '127.0.0.1',
        protocol: 'http',
        settings: { allowTransparent: false },
        sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
      });
    }

    if (connectionMode === 'tun' && !hasTun) {
      const tunInbound: Record<string, any> = {
        tag: 'tun-in',
        port: 0,
        protocol: 'tun' as any,
        settings: {
          name: 'ultima0',
          mtu: 1400,
          inet4_address: '172.19.0.1/30',
        },
      };
      if (options.tunAutoRoute) {
        tunInbound.settings.autoRoute = true;
        tunInbound.settings.strictRoute = true;
      }
      cfg.inbounds.unshift(tunInbound);
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
      network: config.type || 'tcp',
      security: config.security || 'none',
    };

    if (config.security === 'reality') {
      streamSettings.realitySettings = {
        show: false,
        fingerprint: config.fp || APP_CONSTANTS.DEFAULTS.FINGERPRINT,
        serverName: config.sni || '',
        publicKey: config.pbk || '',
        shortId: config.sid || '',
        spiderX: config.spx || '',
      };
    } else if (config.security === 'tls') {
      streamSettings.tlsSettings = {
        serverName: config.sni || '',
        allowInsecure: false,
        alpn: ['h2', 'http/1.1'],
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

    const outbound: XrayOutbound = {
      protocol: 'vless',
      settings: {
        vnext: [
          {
            address: config.address,
            port: config.port,
            users: [{
              id: config.userId || config.uuid,
              encryption: config.encryption || 'none',
              flow: config.flow || '',
            }],
          },
        ],
      },
      streamSettings: streamSettings,
      tag: 'proxy',
    };
    if (connectionMode === 'tun' && options.sendThrough) {
      outbound.sendThrough = options.sendThrough;
    }

    const inboundSocks: XrayInbound = {
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
    };

    const inboundHttp: XrayInbound = {
      tag: 'http',
      port: APP_CONSTANTS.PORTS.HTTP,
      listen: '127.0.0.1',
      protocol: 'http',
      settings: {},
    };

    const inbounds: XrayInbound[] = [inboundSocks, inboundHttp];
    if (connectionMode === 'tun') {
      const tunInbound: Record<string, any> = {
        tag: 'tun-in',
        port: 0,
        protocol: 'tun' as any,
        settings: {
          name: 'ultima0',
          mtu: 1400,
          inet4_address: '172.19.0.1/30',
        },
      };
      if (options.tunAutoRoute) {
        tunInbound.settings.autoRoute = true;
        tunInbound.settings.strictRoute = true;
      }
      inbounds.unshift(tunInbound as XrayInbound);
    }

    return {
      log: {
        loglevel: APP_CONSTANTS.DEFAULTS.LOG_LEVEL,
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
        { protocol: 'freedom', tag: 'direct' },
        { protocol: 'blackhole', tag: 'block' },
      ],
      routing: {
        domainStrategy: 'IPIfNonMatch',
        rules: [
          { type: 'field', protocol: ['bittorrent'], outboundTag: 'block' },
          { type: 'field', ip: ['geoip:private'], outboundTag: 'direct' },
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
}
