import { VlessConfig, WireGuardPeer } from '@/shared/types';
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

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === 'string');
  return items.length > 0 ? items : undefined;
}

function asNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter(
    (item): item is number => typeof item === 'number' && Number.isFinite(item),
  );
  return items.length > 0 ? items : undefined;
}

const PROXY_PROTOCOLS = [
  'vless',
  'vmess',
  'trojan',
  'shadowsocks',
  'hysteria',
  'wireguard',
] as const;

function isProxyOutbound(outbound: Record<string, unknown>): boolean {
  const tag = asString(outbound.tag);
  const protocol = asString(outbound.protocol);
  return tag === 'proxy' || (PROXY_PROTOCOLS as readonly string[]).includes(protocol);
}

function parseEndpointHostPort(endpoint: string): {
  address: string;
  port: number;
} | null {
  const trimmed = endpoint.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('[')) {
    const close = trimmed.indexOf(']');
    if (close < 0) return null;
    const address = trimmed.slice(1, close);
    const rest = trimmed.slice(close + 1);
    if (!rest.startsWith(':')) return null;
    const port = Number(rest.slice(1));
    if (!address || !Number.isInteger(port)) return null;
    return { address, port };
  }
  const colon = trimmed.lastIndexOf(':');
  if (colon <= 0) return null;
  const address = trimmed.slice(0, colon);
  const port = Number(trimmed.slice(colon + 1));
  if (!address || !Number.isInteger(port)) return null;
  return { address, port };
}

function parseWireGuardPeers(settings: Record<string, unknown>): WireGuardPeer[] {
  const peers: WireGuardPeer[] = [];
  for (const item of asArray(settings.peers)) {
    const peer = asRecord(item);
    if (!peer) continue;
    const endpoint = asString(peer.endpoint);
    const publicKey = asString(peer.publicKey);
    if (!endpoint || !publicKey) continue;
    const entry: WireGuardPeer = { endpoint, publicKey };
    const preSharedKey = asString(peer.preSharedKey);
    if (preSharedKey) entry.preSharedKey = preSharedKey;
    if (typeof peer.keepAlive === 'number') entry.keepAlive = peer.keepAlive;
    const allowedIPs = asStringArray(peer.allowedIPs);
    if (allowedIPs) entry.allowedIPs = allowedIPs;
    peers.push(entry);
  }
  return peers;
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
      let hysteriaAuth = '';
      let wgSecretKey = '';
      let wgAddress: string[] | undefined;
      let wgPeers: WireGuardPeer[] | undefined;
      let wgMtu: number | undefined;
      let wgReserved: number[] | undefined;
      let wgNoKernelTun: boolean | undefined;
      let wgDomainStrategy: string | undefined;

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

      if (protocol === 'hysteria' && settings) {
        address = asString(settings.address) || address;
        port = asNumber(settings.port) || port;
      }

      if (protocol === 'wireguard' && settings) {
        wgSecretKey = asString(settings.secretKey);
        wgAddress = asStringArray(settings.address);
        wgPeers = parseWireGuardPeers(settings);
        if (typeof settings.mtu === 'number') wgMtu = settings.mtu;
        wgReserved = asNumberArray(settings.reserved);
        if (typeof settings.noKernelTun === 'boolean') {
          wgNoKernelTun = settings.noKernelTun;
        }
        wgDomainStrategy = asString(settings.domainStrategy) || undefined;
        const endpoint = wgPeers[0]?.endpoint;
        if (endpoint) {
          const parsed = parseEndpointHostPort(endpoint);
          if (parsed) {
            address = parsed.address;
            port = parsed.port;
          }
        }
      }

      if (!address || !port) {
        logger.warn('SubscriptionService', 'Missing address/port', { name });
        continue;
      }

      const stream = asRecord(outbound.streamSettings) ?? {};
      const network =
        asString(stream.method) || asString(stream.network, 'tcp');
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
      let mldsa65Verify: string | undefined;
      let echConfigList: string | undefined;
      let pinnedPeerCertSha256: string | undefined;
      let verifyPeerCertByName: string | undefined;
      let finalmask: Record<string, unknown> | undefined;
      let hysteriaObfs: VlessConfig['hysteriaObfs'];

      if (security === 'reality') {
        const rs = asRecord(stream.realitySettings);
        if (rs) {
          sni = asString(rs.serverName);
          fp = asString(rs.fingerprint);
          pbk = asString(rs.publicKey) || asString(rs.password);
          sid = asString(rs.shortId);
          spx = asString(rs.spiderX);
          mldsa65Verify = asString(rs.mldsa65Verify) || undefined;
        }
      } else if (security === 'tls') {
        const ts = asRecord(stream.tlsSettings);
        if (ts) {
          sni = asString(ts.serverName);
          fp = asString(ts.fingerprint);
          echConfigList = asString(ts.echConfigList) || undefined;
          pinnedPeerCertSha256 =
            asString(ts.pinnedPeerCertSha256) || undefined;
          verifyPeerCertByName =
            asString(ts.verifyPeerCertByName) || undefined;
        }
      }

      const hysteriaSettings = asRecord(stream.hysteriaSettings);
      if (hysteriaSettings) {
        hysteriaAuth = asString(hysteriaSettings.auth) || hysteriaAuth;
      }

      const streamFinalmask = asRecord(stream.finalmask);
      if (streamFinalmask) {
        finalmask = streamFinalmask;
        const udp = asArray(streamFinalmask.udp);
        for (const item of udp) {
          const entry = asRecord(item);
          if (!entry || asString(entry.type).toLowerCase() !== 'salamander') {
            continue;
          }
          const salamanderSettings = asRecord(entry.settings);
          const password = asString(salamanderSettings?.password);
          if (password) {
            hysteriaObfs = { type: 'salamander', password };
            break;
          }
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
          'hysteria',
        ].includes(network)
          ? network
          : protocol === 'hysteria'
            ? 'hysteria'
            : undefined
      ) as VlessConfig['type'];
      const secType = (
        ['reality', 'tls', 'none'].includes(security)
          ? security
          : protocol === 'hysteria'
            ? 'tls'
            : undefined
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
            : hysteriaAuth
              ? createHashedIdentityToken('hy2', hysteriaAuth, address, port)
              : wgSecretKey
                ? createHashedIdentityToken('wg', wgSecretKey, address, port)
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
        mldsa65Verify,
        echConfigList,
        hysteriaAuth,
        wgSecretKey,
      ]);

      const outboundProtocol = (
        PROXY_PROTOCOLS as readonly string[]
      ).includes(protocol)
        ? (protocol as VlessConfig['protocol'])
        : undefined;

      results.push({
        uuid: stableId,
        userId:
          trojanPasswordToken ||
          shadowsocksPasswordToken ||
          hysteriaAuth ||
          wgSecretKey
            ? undefined
            : userUUID || undefined,
        address,
        port,
        name,
        protocol: outboundProtocol,
        password:
          trojanPasswordToken ||
          shadowsocksPasswordToken ||
          hysteriaAuth ||
          undefined,
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
        mldsa65Verify,
        echConfigList,
        pinnedPeerCertSha256,
        verifyPeerCertByName,
        finalmask,
        hysteriaAuth: hysteriaAuth || undefined,
        hysteriaObfs,
        wgSecretKey: wgSecretKey || undefined,
        wgAddress,
        wgPeers,
        wgMtu,
        wgReserved,
        wgNoKernelTun,
        wgDomainStrategy,
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
