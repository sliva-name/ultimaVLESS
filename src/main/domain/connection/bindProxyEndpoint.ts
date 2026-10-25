import net from 'net';
import { unbracketIpv6 } from '@/shared/networkAddresses';
import type { VlessConfig } from '@/shared/types';
import type { XrayConfig } from '@/shared/xray-types';

type MutableNode = Record<string, unknown>;

const HOST_TRANSPORT_SETTINGS = [
  'wsSettings',
  'httpupgradeSettings',
  'xhttpSettings',
  'splithttpSettings',
] as const;

function asNode(value: unknown): MutableNode | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as MutableNode)
    : null;
}

function isDomain(address: unknown): address is string {
  return (
    typeof address === 'string' &&
    address !== '' &&
    net.isIP(unbracketIpv6(address)) === 0
  );
}

/**
 * Xray derives the TLS/REALITY server name, and then the WS/HTTPUpgrade/XHTTP
 * `Host`, from the outbound address when they are left empty. Once that
 * address is an IP there is no SNI and the certificate is checked against the
 * IP, so the domain is written in where Xray would otherwise have used it.
 * @see https://xtls.github.io/config/transports/tls.html (`serverName`)
 */
function keepRawServerName(stream: MutableNode, domain: string): void {
  const security = String(stream.security ?? '').toLowerCase();
  let serverName = '';
  if (security === 'tls' || security === 'reality') {
    const key = security === 'tls' ? 'tlsSettings' : 'realitySettings';
    const settings = asNode(stream[key]) ?? {};
    if (typeof settings.serverName !== 'string' || !settings.serverName) {
      settings.serverName = domain;
    }
    serverName = settings.serverName as string;
    stream[key] = settings;
  }
  for (const key of HOST_TRANSPORT_SETTINGS) {
    const transport = asNode(stream[key]);
    if (!transport) continue;
    if (typeof transport.host === 'string' && transport.host) continue;
    const headers = asNode(transport.headers);
    if (
      headers &&
      Object.keys(headers).some((h) => h.toLowerCase() === 'host')
    ) {
      continue;
    }
    transport.host = serverName || domain;
  }
}

/**
 * Point the proxy outbound at a resolved IPv4/IPv6 literal. On Windows Xray
 * would look the server's domain up through the system resolver, whose queries
 * go into the TUN and back into Xray. The original host stays the TLS/REALITY
 * server name and the transport `Host`.
 */
export function bindProxyEndpointToIp(
  server: VlessConfig,
  ip: string,
): VlessConfig {
  if (!ip || server.address === ip) return server;

  const next: VlessConfig = { ...server, address: ip };
  // `sni` also feeds the WS/HTTPUpgrade/XHTTP host when `host` is empty.
  if (isDomain(server.address) && !server.sni) {
    next.sni = server.address;
  }
  if (!server.rawConfig) return next;

  const raw = JSON.parse(JSON.stringify(server.rawConfig)) as XrayConfig;
  if (Array.isArray(raw.outbounds)) {
    for (const outbound of raw.outbounds) {
      if (!outbound || (outbound.tag && outbound.tag !== 'proxy')) continue;
      const settings = outbound.settings as MutableNode | undefined;
      if (!settings) continue;
      let domain: string | undefined;
      if (typeof settings.address === 'string') {
        if (isDomain(settings.address)) domain = settings.address;
        settings.address = ip;
      }
      const vnext = settings.vnext;
      if (Array.isArray(vnext)) {
        for (const entry of vnext) {
          const node = asNode(entry);
          if (!node) continue;
          if (!domain && isDomain(node.address)) domain = node.address;
          node.address = ip;
        }
      }
      const stream = asNode(outbound.streamSettings);
      if (domain && stream) keepRawServerName(stream, domain);
    }
  }
  next.rawConfig = raw;
  return next;
}
