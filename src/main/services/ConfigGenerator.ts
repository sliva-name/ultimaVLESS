import { VlessConfig } from '../../shared/types';
import { XrayConfig, XrayOutbound, XrayInbound, XrayStreamSettings } from '../../shared/xray-types';
import { APP_CONSTANTS } from '../../shared/constants';

/**
 * Service responsible for generating Xray-core JSON configuration.
 * Transforms internal VlessConfig into Xray-compatible JSON structure.
 */
export class ConfigGenerator {
  
  /**
   * Generates a complete Xray configuration object.
   * 
   * @param {VlessConfig} config - The internal VLESS configuration.
   * @param {string} logPath - The file path where Xray should write its logs.
   * @returns {XrayConfig} The valid Xray JSON configuration.
   */
  static generate(config: VlessConfig, logPath: string): XrayConfig {
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
      };
    }

    if (config.type === 'ws') {
        streamSettings.wsSettings = {
            path: config.path || '/',
            headers: {
                Host: config.host || config.sni || ''
            }
        }
    }

    if (config.type === 'grpc') {
        streamSettings.grpcSettings = {
            serviceName: config.serviceName || ''
        }
    }

    const outbound: XrayOutbound = {
      protocol: 'vless',
      settings: {
        vnext: [
          {
            address: config.address,
            port: config.port,
            users: [
              {
                id: config.uuid,
                encryption: config.encryption || 'none',
                flow: config.flow || '',
              },
            ],
          },
        ],
      },
      streamSettings: streamSettings,
      tag: 'proxy',
    };

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
      settings: {
        timeout: 0,
      },
    };

    return {
      log: {
        loglevel: APP_CONSTANTS.DEFAULTS.LOG_LEVEL,
        access: logPath,
        error: logPath,
      },
      inbounds: [inboundSocks, inboundHttp],
      outbounds: [
        outbound,
        {
          protocol: 'freedom',
          tag: 'direct',
        },
        {
          protocol: 'blackhole',
          tag: 'block',
        },
      ],
      routing: {
        domainStrategy: 'IPIfNonMatch',
        rules: [
          {
            type: 'field',
            ip: ['geoip:private'],
            outboundTag: 'direct',
          },
          {
            type: 'field',
            port: '0-65535',
            outboundTag: 'proxy',
          },
        ],
      },
    };
  }
}
