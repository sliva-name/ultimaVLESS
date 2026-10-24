import net from 'net';
import { BUNDLED_XRAY_VERSION } from '@/shared/constants';
import { unbracketIpv6 } from '@/shared/networkAddresses';
import type { VlessConfig } from '@/shared/types';
import type { XrayOutbound } from '@/shared/xray-types';

const REMOVED_SS_METHODS = new Set(['none', 'plain']);
const REMOVED_VMESS_SECURITY = new Set(['none', 'zero']);

/**
 * Xray's own private matchers. Without TLS, REALITY or VLESS encryption Xray
 * refuses VLESS/Trojan unless the server address matches one of them.
 * @see https://github.com/XTLS/Xray-core/blob/main/common/geodata/consts.go
 * @see https://github.com/XTLS/Xray-core/blob/main/infra/conf/xray.go (`requiresTransportSecurity`)
 */
const XRAY_PRIVATE_SUBNETS: ReadonlyArray<[string, number, 'ipv4' | 'ipv6']> = [
  ['0.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.0.0.0', 24, 'ipv4'],
  ['192.0.2.0', 24, 'ipv4'],
  ['192.88.99.0', 24, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'],
  ['198.51.100.0', 24, 'ipv4'],
  ['203.0.113.0', 24, 'ipv4'],
  ['224.0.0.0', 3, 'ipv4'],
  ['::', 127, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
  ['ff00::', 8, 'ipv6'],
];

const xrayPrivateIps = new net.BlockList();
for (const [address, prefix, type] of XRAY_PRIVATE_SUBNETS) {
  xrayPrivateIps.addSubnet(address, prefix, type);
}

/** Each entry matches the name itself and its subdomains. */
const XRAY_PRIVATE_DOMAINS = [
  'lan',
  'localdomain',
  'example',
  'invalid',
  'localhost',
  'test',
  'local',
  'home.arpa',
  'internal',
];

const XRAY_DOTLESS_DOMAIN = /^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function isPrivateOrLocalEndpoint(hostname: string): boolean {
  const host = unbracketIpv6(hostname.trim());
  if (!host) return false;

  // Go's net.ParseIP rejects zone ids, so Xray reads those as domains.
  // BlockList, like Xray, matches IPv4-mapped IPv6 against the IPv4 subnets.
  const ipVersion = host.includes('%') ? 0 : net.isIP(host);
  if (ipVersion !== 0) {
    return xrayPrivateIps.check(host, ipVersion === 4 ? 'ipv4' : 'ipv6');
  }

  const domain = host.toLowerCase().replace(/\.$/, '');
  return (
    XRAY_DOTLESS_DOMAIN.test(domain) ||
    XRAY_PRIVATE_DOMAINS.some(
      (suffix) => domain === suffix || domain.endsWith(`.${suffix}`),
    )
  );
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
  // Xray's Hysteria dialer needs TLS whatever the address.
  if (protocol === 'hysteria') {
    if ((options.streamSecurity || '').toLowerCase() === 'tls') return;
    throw new Error(
      `Hysteria requires streamSettings.security=tls in Xray ${BUNDLED_XRAY_VERSION}.`,
    );
  }

  if (protocol !== 'vless' && protocol !== 'trojan') return;
  if (isPrivateOrLocalEndpoint(options.address)) return;
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

/**
 * `allowInsecure` is gone from Xray; its replacements are `pcs` / `vcn`.
 * Panels still put `insecure=1` next to them for older clients, and a leaf
 * pin alone already accepts the certificate, so the flag only matters when
 * neither is given.
 * @see https://xtls.github.io/config/transports/tls.html (`pinnedPeerCertSha256`)
 */
export function assertAllowInsecureNotUsed(
  allowInsecure: unknown,
  replacements: {
    pinnedPeerCertSha256?: unknown;
    verifyPeerCertByName?: unknown;
  } = {},
): void {
  const replaced = [
    replacements.pinnedPeerCertSha256,
    replacements.verifyPeerCertByName,
  ].some((value) => typeof value === 'string' && value.trim() !== '');
  if (allowInsecure === true && !replaced) {
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

/**
 * UDP masks that dial by themselves. Xray reverses `finalmask.udp` so the
 * last mask sits on the socket, and fails every dial ("incorrect index")
 * unless such a mask is listed last; `xray run -test` does not catch it.
 */
const DIALING_UDP_MASKS = new Set(['udphop', 'xicmp']);

function udpMaskType(mask: unknown): string {
  if (!mask || typeof mask !== 'object') return '';
  const type = (mask as Record<string, unknown>).type;
  return typeof type === 'string' ? type.trim().toLowerCase() : '';
}

export function isDialingUdpMask(mask: unknown): boolean {
  return DIALING_UDP_MASKS.has(udpMaskType(mask));
}

export function hasUdpMask(
  finalmask: Record<string, unknown> | undefined,
  type: string,
): boolean {
  const udp = finalmask?.udp;
  return Array.isArray(udp) && udp.some((mask) => udpMaskType(mask) === type);
}

/** Adds masks to `finalmask.udp`, keeping a trailing dialing mask last. */
export function addUdpMasks(
  finalmask: Record<string, unknown>,
  masks: unknown[],
): void {
  const udp = Array.isArray(finalmask.udp) ? [...finalmask.udp] : [];
  const at = isDialingUdpMask(udp[udp.length - 1])
    ? udp.length - 1
    : udp.length;
  udp.splice(at, 0, ...masks);
  finalmask.udp = udp;
}

/**
 * Xray turned port hopping into a `udphop` UDP mask and now ignores
 * `finalmask.quicParams.udpHop`, so such a config would stay on one port.
 * The old hop opened a new local socket and picked a new server port each
 * interval; a dialing mask must come last in `finalmask.udp`.
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
  finalmask.udp = [...udp, { type: 'udphop', settings }];
}
