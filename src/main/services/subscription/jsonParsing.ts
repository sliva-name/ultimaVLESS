import { createHash } from 'crypto';
import { VlessConfig } from '@/shared/types';
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

function makeServerIdentity(
  authToken: string,
  address: string,
  port: number,
  parts: Array<string | undefined>,
): string {
  const signature = [
    authToken,
    address,
    String(port),
    ...parts.map((part) => part || ''),
  ].join('|');
  const digest = createHash('sha256')
    .update(signature)
    .digest('hex')
    .slice(0, 16);
  return `${authToken.substring(0, 8)}-${address}:${port}-${digest}`;
}

function isProxyOutbound(outbound: Record<string, unknown>): boolean {
  const tag = asString(outbound.tag);
  const protocol = asString(outbound.protocol);
  return tag === 'proxy' || ['vless', 'vmess', 'trojan'].includes(protocol);
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
        const s0 = asRecord(servers[0]);
        if (s0) {
          address = asString(s0.address);
          port = asNumber(s0.port);
          trojanPasswordToken = asString(s0.password);
        }
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
        const headers = asRecord(wsSettings.headers);
        host = asString(headers?.Host);
      }
      const grpcSettings = asRecord(stream.grpcSettings);
      if (grpcSettings) {
        serviceName = asString(grpcSettings.serviceName);
      }

      const networkType = (
        ['tcp', 'raw', 'kcp', 'ws', 'http', 'grpc', 'quic'].includes(network)
          ? network
          : undefined
      ) as VlessConfig['type'];
      const secType = (
        ['reality', 'tls', 'none'].includes(security) ? security : undefined
      ) as VlessConfig['security'];

      // Avoid embedding raw trojan password in uuid (makeServerIdentity prefixes authToken).
      const idToken =
        trojanPasswordToken.length > 0
          ? `tj${createHash('sha256').update(`${trojanPasswordToken}|${address}|${port}`).digest('hex').slice(0, 14)}`
          : userUUID || 'user';
      const stableId = makeServerIdentity(idToken, address, port, [
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
      ]);

      results.push({
        uuid: stableId,
        userId: trojanPasswordToken ? undefined : userUUID || undefined,
        address,
        port,
        name,
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
