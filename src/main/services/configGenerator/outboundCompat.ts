import net from 'net';
import { BUNDLED_XRAY_VERSION } from '@/shared/constants';

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
  if (normalized === 'localhost' || normalized.endsWith('.localhost'))
    return true;
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (PRIVATE_DOMAIN_SUFFIXES.some((suffix) => normalized === suffix))
    return true;
  if (
    PRIVATE_DOMAIN_SUFFIXES.some((suffix) => normalized.endsWith(`.${suffix}`))
  ) {
    return true;
  }
  // Xray also treats single-label (dotless) names as private.
  if (!normalized.includes('.')) return true;

  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) {
    const octets = normalized.split('.').map(Number);
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
    return (
      normalized === '::' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:') ||
      normalized.startsWith('ff')
    );
  }

  return false;
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
  if (protocol === 'wireguard' || protocol === 'shadowsocks' || protocol === 'vmess') {
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
