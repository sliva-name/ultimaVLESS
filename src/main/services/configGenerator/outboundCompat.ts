import net from 'net';
import { BUNDLED_XRAY_VERSION } from '@/shared/constants';
import { isPrivateOrReservedHost } from '@/shared/networkAddresses';
import type { VlessConfig } from '@/shared/types';
import type { XrayOutbound } from '@/shared/xray-types';

const REMOVED_SS_METHODS = new Set(['none', 'plain']);
const REMOVED_VMESS_SECURITY = new Set(['none', 'zero']);

/** Hosts Xray still treats as private / local (see geodata private matchers). */
const PRIVATE_DOMAIN_SUFFIXES = [
  'localhost',
  'local',
  'lan',
  'localdomain',
  'home.arpa',
  'internal',
  'test',
  'invalid',
  'example',
];

export function isPrivateOrLocalEndpoint(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!normalized) return false;
  const host =
    normalized.startsWith('[') && normalized.endsWith(']')
      ? normalized.slice(1, -1)
      : normalized;

  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    const octets = host.split('.').map(Number);
    if (octets.length !== 4 || octets.some((value) => Number.isNaN(value))) {
      return false;
    }
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  if (ipVersion === 6) {
    // Mapped IPv4, loopback, ULA and link-local share the SSRF helper.
    if (isPrivateOrReservedHost(host)) return true;
    // Xray also treats multicast (ff00::/8) as non-public.
    return host === '::' || host.startsWith('ff');
  }

  if (PRIVATE_DOMAIN_SUFFIXES.some((suffix) => host === suffix)) return true;
  if (PRIVATE_DOMAIN_SUFFIXES.some((suffix) => host.endsWith(`.${suffix}`))) {
    return true;
  }
  // Xray also treats single-label (dotless) names as private.
  return !host.includes('.');
}

export function normalizeVmessSecurity(security: string | undefined): string {
  const value = (security || 'auto').toLowerCase();
  if (REMOVED_VMESS_SECURITY.has(value)) return 'auto';
  return security || 'auto';
}

export function assertSupportedShadowsocksMethod(method: string): void {
  const normalized = method.trim().toLowerCase();
  if (!normalized) {
    throw new Error('Shadowsocks method is required.');
  }
  if (REMOVED_SS_METHODS.has(normalized)) {
    throw new Error(
      `Shadowsocks method "${method}" was removed in Xray ${BUNDLED_XRAY_VERSION}; use an AEAD cipher (e.g. aes-128-gcm, chacha20-poly1305).`,
    );
  }
}

export function hasStreamTransportSecurity(
  security: string | undefined,
): boolean {
  const value = (security || 'none').toLowerCase();
  return value === 'tls' || value === 'reality';
}

export function hasVlessPayloadEncryption(
  encryption: string | undefined,
): boolean {
  const value = (encryption || 'none').trim();
  return value !== '' && value.toLowerCase() !== 'none';
}

export function assertEncryptedPublicOutbound(options: {
  protocol: string;
  address: string;
  streamSecurity?: string;
  vlessEncryption?: string;
}): void {
  const protocol = options.protocol.toLowerCase();
  if (
    protocol === 'wireguard' ||
    protocol === 'shadowsocks' ||
    protocol === 'vmess'
  ) {
    return;
  }
  if (isPrivateOrLocalEndpoint(options.address)) return;

  if (protocol === 'hysteria') {
    if ((options.streamSecurity || '').toLowerCase() === 'tls') return;
    throw new Error(
      `Hysteria requires streamSettings.security=tls in Xray ${BUNDLED_XRAY_VERSION}.`,
    );
  }

  if (protocol !== 'vless' && protocol !== 'trojan') return;
  if (hasStreamTransportSecurity(options.streamSecurity)) return;
  if (
    protocol === 'vless' &&
    hasVlessPayloadEncryption(options.vlessEncryption)
  ) {
    return;
  }

  const transportHint =
    protocol === 'trojan'
      ? 'Trojan requires TLS (or REALITY) for public server addresses'
      : 'VLESS requires TLS/REALITY (or VLESS Encryption) for public server addresses';
  throw new Error(
    `${transportHint} in Xray ${BUNDLED_XRAY_VERSION}. Set security=tls or security=reality.`,
  );
}

export function isEncryptedPublicOutboundCompatible(options: {
  protocol: string;
  address: string;
  streamSecurity?: string;
  vlessEncryption?: string;
}): boolean {
  try {
    assertEncryptedPublicOutbound(options);
    return true;
  } catch {
    return false;
  }
}

/**
 * Default stream security used by field-based config generation
 * (`XrayConfigPipeline.getDefaultSecurity`).
 */
function defaultStructuredStreamSecurity(
  protocol: string,
  security: VlessConfig['security'],
): string {
  if (security) return security;
  if (protocol === 'trojan' || protocol === 'hysteria') return 'tls';
  return 'none';
}

function readRawOutboundAddress(settings: unknown): string | undefined {
  if (!settings || typeof settings !== 'object') return undefined;
  const record = settings as Record<string, unknown>;
  if (typeof record.address === 'string' && record.address) {
    return record.address;
  }
  const vnext = record.vnext;
  if (Array.isArray(vnext) && vnext[0] && typeof vnext[0] === 'object') {
    const address = (vnext[0] as Record<string, unknown>).address;
    if (typeof address === 'string' && address) return address;
  }
  const servers = record.servers;
  if (Array.isArray(servers) && servers[0] && typeof servers[0] === 'object') {
    const address = (servers[0] as Record<string, unknown>).address;
    if (typeof address === 'string' && address) return address;
  }
  return undefined;
}

function readRawVlessEncryption(settings: unknown): string | undefined {
  if (!settings || typeof settings !== 'object') return undefined;
  const record = settings as Record<string, unknown>;
  if (typeof record.encryption === 'string') return record.encryption;
  const vnext = record.vnext;
  if (!Array.isArray(vnext) || !vnext[0] || typeof vnext[0] !== 'object') {
    return undefined;
  }
  const users = (vnext[0] as Record<string, unknown>).users;
  if (!Array.isArray(users) || !users[0] || typeof users[0] !== 'object') {
    return undefined;
  }
  const encryption = (users[0] as Record<string, unknown>).encryption;
  return typeof encryption === 'string' ? encryption : undefined;
}

function collectPublicOutboundCompatTargets(server: VlessConfig): Array<{
  protocol: string;
  address: string;
  streamSecurity?: string;
  vlessEncryption?: string;
}> {
  const rawOutbounds = server.rawConfig?.outbounds;
  if (Array.isArray(rawOutbounds) && rawOutbounds.length > 0) {
    const targets: Array<{
      protocol: string;
      address: string;
      streamSecurity?: string;
      vlessEncryption?: string;
    }> = [];
    for (const outbound of rawOutbounds as XrayOutbound[]) {
      if (!outbound || typeof outbound !== 'object') continue;
      const protocol = String(outbound.protocol || '').toLowerCase();
      if (
        protocol !== 'vless' &&
        protocol !== 'trojan' &&
        protocol !== 'hysteria'
      ) {
        continue;
      }
      const address = readRawOutboundAddress(outbound.settings);
      if (!address) continue;
      const stream = outbound.streamSettings;
      const streamSecurity =
        stream &&
        typeof stream === 'object' &&
        typeof (stream as { security?: unknown }).security === 'string'
          ? (stream as { security: string }).security
          : undefined;
      targets.push({
        protocol,
        address,
        streamSecurity,
        vlessEncryption:
          protocol === 'vless'
            ? readRawVlessEncryption(outbound.settings)
            : undefined,
      });
    }
    if (targets.length > 0) return targets;
  }

  const protocol = (server.protocol || 'vless').toLowerCase();
  return [
    {
      protocol,
      address: server.address,
      streamSecurity: defaultStructuredStreamSecurity(
        protocol,
        server.security,
      ),
      vlessEncryption: server.encryption,
    },
  ];
}

/**
 * True when config generation would accept this catalog server under the
 * bundled Xray public-outbound encryption rules. Reuses
 * `assertEncryptedPublicOutbound` so auto-switch skip matches generation.
 */
export function isServerPublicOutboundCompatible(server: VlessConfig): boolean {
  return collectPublicOutboundCompatTargets(server).every((target) =>
    isEncryptedPublicOutboundCompatible(target),
  );
}

export function assertAllowInsecureNotUsed(allowInsecure: unknown): void {
  if (allowInsecure === true) {
    throw new Error(
      `"allowInsecure" was removed in bundled Xray ${BUNDLED_XRAY_VERSION}; use pinnedPeerCertSha256 (pcs) and/or verifyPeerCertByName (vcn) instead.`,
    );
  }
}

/**
 * Public Trojan without Mux forms detectable TLS-in-TLS (TiT).
 * Project X docs require Mux for public Trojan outbounds.
 */
export function requiresPublicTrojanMux(address: string): boolean {
  return !isPrivateOrLocalEndpoint(address);
}

/** Values the removed WireGuard `settings.domainStrategy` accepted. */
const WIREGUARD_DOMAIN_STRATEGIES = new Map([
  ['forceip', 'ForceIP'],
  ['forceipv4', 'ForceIPv4'],
  ['forceipv6', 'ForceIPv6'],
  ['forceipv4v6', 'ForceIPv4v6'],
  ['forceipv6v4', 'ForceIPv6v4'],
]);

/**
 * Xray dropped WireGuard `settings.domainStrategy` (now silently ignored);
 * resolving targets inside the tunnel moved to the outbound's
 * `targetStrategy`, which takes the same values.
 * @see https://github.com/XTLS/Xray-core/pull/6771
 */
export function wireGuardTargetStrategy(
  domainStrategy: unknown,
): string | undefined {
  if (typeof domainStrategy !== 'string') return undefined;
  return WIREGUARD_DOMAIN_STRATEGIES.get(domainStrategy.trim().toLowerCase());
}

/** UDP masks that dial by themselves; Xray only accepts them first. */
const DIALING_UDP_MASKS = new Set(['udphop', 'xicmp']);

export function isDialingUdpMask(mask: unknown): boolean {
  if (!mask || typeof mask !== 'object') return false;
  const type = (mask as Record<string, unknown>).type;
  return (
    typeof type === 'string' && DIALING_UDP_MASKS.has(type.trim().toLowerCase())
  );
}

/**
 * Xray turned port hopping into a `udphop` UDP mask and now ignores
 * `finalmask.quicParams.udpHop`, so such a config would stay on one port.
 * The old hop opened a new local socket and picked a new server port each
 * interval; a dialing mask must come first in `finalmask.udp`.
 * @see https://github.com/XTLS/Xray-core/pull/6327
 */
export function migrateLegacyUdpHop(finalmask: Record<string, unknown>): void {
  const quicParams = finalmask.quicParams;
  if (!quicParams || typeof quicParams !== 'object') return;
  const params = quicParams as Record<string, unknown>;
  if (params.udpHop === undefined) return;

  const legacy =
    params.udpHop && typeof params.udpHop === 'object'
      ? (params.udpHop as Record<string, unknown>)
      : {};
  delete params.udpHop;
  if (Object.keys(params).length === 0) delete finalmask.quicParams;

  // Without ports the old hop never engaged.
  if (legacy.ports === undefined || legacy.ports === '') return;
  const udp = Array.isArray(finalmask.udp) ? finalmask.udp : [];
  if (udp.some(isDialingUdpMask)) return;

  const settings: Record<string, unknown> = {
    mode: 'intervalLocal,intervalRemote',
    remotePorts: legacy.ports,
  };
  if (legacy.interval !== undefined) settings.interval = legacy.interval;
  finalmask.udp = [{ type: 'udphop', settings }, ...udp];
}
