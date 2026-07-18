import type { VlessConfig } from '@/shared/types';
import type { XrayConfig } from '@/shared/xray-types';

/**
 * Point the proxy outbound at a resolved IPv4/IPv6 literal so TUN dials do not
 * use the system dual-stack resolver (AAAA-first hangs of ~12s are common when
 * ::/0 is already via TUN). REALITY/TLS serverName stays on the original host.
 */
export function bindProxyEndpointToIp(
  server: VlessConfig,
  ip: string,
): VlessConfig {
  if (!ip || server.address === ip) return server;

  const next: VlessConfig = { ...server, address: ip };
  if (!server.rawConfig) return next;

  const raw = JSON.parse(JSON.stringify(server.rawConfig)) as XrayConfig;
  if (Array.isArray(raw.outbounds)) {
    for (const outbound of raw.outbounds) {
      if (!outbound || (outbound.tag && outbound.tag !== 'proxy')) continue;
      const settings = outbound.settings as Record<string, unknown> | undefined;
      if (!settings) continue;
      if (typeof settings.address === 'string') {
        settings.address = ip;
      }
      const vnext = settings.vnext;
      if (Array.isArray(vnext)) {
        for (const entry of vnext) {
          if (entry && typeof entry === 'object') {
            (entry as Record<string, unknown>).address = ip;
          }
        }
      }
    }
  }
  next.rawConfig = raw;
  return next;
}
