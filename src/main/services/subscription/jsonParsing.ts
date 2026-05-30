import { VlessConfig } from '@/shared/types';
import {
  createHashedIdentityToken,
  createStableServerId,
} from '@/shared/serverIdentity';
import { logger } from '@/main/services/LoggerService';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isProxyOutbound(outbound: Record<string, unknown>): boolean {
  const tag = asString(outbound.tag);
  const protocol = asString(outbound.protocol);
  return (
    tag === 'proxy' ||
    ['vless', 'vmess', 'trojan', 'shadowsocks'].includes(protocol)
  );
}

export function parseJsonConfigs(configs: unknown[]): VlessConfig[] {
  const results: VlessConfig[] = [];

  for (const cfg of configs) {
    try {
      const root = asRecord(cfg);
      if (!root) continue;

      const name = asString(root.remarks) || asString(root.ps) || 'Server';
      const outbounds = asArray(root.outbounds);
      const proxyOutbound = outbounds.find((item) => {
        const outbound = asRecord(item);
        return outbound ? isProxyOutbound(outbound) : false;
      });

      const outbound = asRecord(proxyOutbound);
      if (!outbound) {
        logger.warn('SubscriptionService', 'No proxy outbound found', { name });
        continue;
      }

      const protocol = asString(outbound.protocol);
      let address = '';
      let port = 0;
      let userUUID = '';
      let flow = '';
      let encryption = 'none';
      let trojanPasswordToken = '';
      let shadowsocksPasswordToken = '';
      let shadowsocksMethod = '';

      const settings = asRecord(outbound.settings);
      const vnext = asArray(settings?.vnext);
      if (vnext.length > 0) {
        const firstVnext = asRecord(vnext[0]);
        if (firstVnext) {
          address = asString(firstVnext.address);
          port = asNumber(firstVnext.port);
          const users = asArray(firstVnext.users);
          if (users.length > 0) {
            const firstUser = asRecord(users[0]);
            if (firstUser) {
              userUUID = asString(firstUser.id);
              flow = asString(firstUser.flow);
              encryption = asString(firstUser.encryption, 'none') || 'none';
            }
          }
        }
      }

      // Docs-style flat VLESS outbound: settings.address / settings.port / settings.id (no vnext).
      if (
        (!address || !port) &&
        settings &&
        ['vless', 'vmess'].includes(protocol)
      ) {
        const flatAddr = asString(settings.address);
        const flatPort = asNumber(settings.port);
        if (flatAddr && flatPort) {
          address = flatAddr;
          port = flatPort;
          userUUID = asString(settings.id);
          flow = asString(settings.flow);
          encryption = asString(settings.encryption, 'none') || 'none';
        }
      }

      if ((!address || !port) && protocol === 'trojan' && settings) {
        const servers = asArray(settings.servers);
        const s0 = asRecord(servers[0]) ?? settings;
        address = asString(s0.address);
        port = asNumber(s0.port);
        trojanPasswordToken = asString(s0.password);
      }

      if ((!address || !port) && protocol === 'shadowsocks' && settings) {
        const servers = asArray(settings.servers);
        const s0 = asRecord(servers[0]) ?? settings;
        address = asString(s0.address);
        port = asNumber(s0.port);
        shadowsocksMethod = asString(s0.method);
        shadowsocksPasswordToken = asString(s0.password);
      }

      if (!address || !port) {
        logger.warn('SubscriptionService', 'Missing address/port', { name });
        continue;
      }

      const stream = asRecord(outbound.streamSettings) ?? {};
      const network = asString(stream.network, 'tcp');
      const security = asString(stream.security, 'none');

      let sni = '';
      let fp = '';
      let pbk = '';
      let sid = '';
      let spx = '';
      let path = '';
      let host = '';
      let serviceName = '';
      let mode = '';
      let xhttpExtra: Record<string, unknown> | undefined;
      let noGRPCHeader = false;

      if (security === 'reality') {
        const rs = asRecord(stream.realitySettings);
        if (rs) {
          sni = asString(rs.serverName);
          fp = asString(rs.fingerprint);
          pbk = asString(rs.publicKey) || asString(rs.password);
          sid = asString(rs.shortId);
          spx = asString(rs.spiderX);
        }
      } else if (security === 'tls') {
        const ts = asRecord(stream.tlsSettings);
        if (ts) {
          sni = asString(ts.serverName);
          fp = asString(ts.fingerprint);
        }
      }

      const wsSettings = asRecord(stream.wsSettings);
      if (wsSettings) {
        path = asString(wsSettings.path);
        host = asString(wsSettings.host);
        const headers = asRecord(wsSettings.headers);
        host = host || asString(headers?.Host);
      }
      const grpcSettings = asRecord(stream.grpcSettings);
      if (grpcSettings) {
        serviceName = asString(grpcSettings.serviceName);
      }
      const xhttpSettings =
        asRecord(stream.xhttpSettings) ?? asRecord(stream.splithttpSettings);
      if (xhttpSettings) {
        path = asString(xhttpSettings.path);
        host = asString(xhttpSettings.host);
        mode = asString(xhttpSettings.mode);
        xhttpExtra = asRecord(xhttpSettings.extra) ?? undefined;
        noGRPCHeader = xhttpExtra?.noGRPCHeader === true;
      }

      const networkType = (
        [
          'tcp',
          'raw',
          'kcp',
          'mkcp',
          'ws',
          'websocket',
          'http',
          'grpc',
          'quic',
          'xhttp',
          'splithttp',
          'httpupgrade',
        ].includes(network)
          ? network
          : undefined
      ) as VlessConfig['type'];
      const secType = (
        ['reality', 'tls', 'none'].includes(security) ? security : undefined
      ) as VlessConfig['security'];

      // Avoid embedding raw trojan password in uuid (stable ids prefix authToken).
      const idToken =
        trojanPasswordToken.length > 0
          ? createHashedIdentityToken('tj', trojanPasswordToken, address, port)
          : shadowsocksPasswordToken.length > 0
            ? createHashedIdentityToken(
                'ss',
                `${shadowsocksMethod}:${shadowsocksPasswordToken}`,
                address,
                port,
              )
            : userUUID || 'user';
      const stableId = createStableServerId(idToken, address, port, [
        network,
        security,
        protocol,
        sni,
        fp,
        pbk,
        sid,
        spx,
        path,
        host,
        serviceName,
        flow,
        encryption,
        mode,
        JSON.stringify(xhttpExtra ?? {}),
        String(noGRPCHeader),
      ]);

      const outboundProtocol = [
        'vless',
        'vmess',
        'trojan',
        'shadowsocks',
      ].includes(protocol)
        ? (protocol as VlessConfig['protocol'])
        : undefined;

      results.push({
        uuid: stableId,
        userId:
          trojanPasswordToken || shadowsocksPasswordToken
            ? undefined
            : userUUID || undefined,
        address,
        port,
        name,
        protocol: outboundProtocol,
        password: trojanPasswordToken || shadowsocksPasswordToken || undefined,
        method: shadowsocksMethod || undefined,
        flow,
        encryption,
        type: networkType,
        security: secType,
        sni,
        fp,
        pbk,
        sid,
        spx,
        path,
        host,
        serviceName,
        mode,
        xhttpExtra,
        noGRPCHeader,
        rawConfig: cfg as Record<string, unknown>,
      });
    } catch (error) {
      logger.error('SubscriptionService', 'Error parsing JSON config', error);
    }
  }

  logger.info('SubscriptionService', 'Parsed JSON configs', {
    count: results.length,
  });
  return results;
}
