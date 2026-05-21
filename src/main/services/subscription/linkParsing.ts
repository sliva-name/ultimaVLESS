import { createHash } from 'crypto';
import { VlessConfig } from '@/shared/types';
import { logger } from '@/main/services/LoggerService';

function safeDecodeComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isTruthyQueryParam(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function parseOptionalBooleanQueryParam(
  value: string | null,
): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no') {
    return false;
  }
  return undefined;
}

function parseOptionalNumberQueryParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
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

function normalizeLinkForParsing(link: string): string {
  return link.trim().replace(/&amp;/gi, '&');
}

function parseJsonObjectParam(
  value: string | null,
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    logger.warn('SubscriptionService', 'Ignoring invalid JSON query param', {
      param: value.substring(0, 50) + '...',
    });
  }
  return undefined;
}

export function isSupportedLink(link: string): boolean {
  return (
    link.startsWith('vless://') ||
    link.startsWith('trojan://') ||
    link.startsWith('ss://')
  );
}

export function extractSupportedLinks(input: string): string[] {
  // Stop before common HTML delimiters so links embedded in markup are still valid.
  const matches = input.match(/(?:vless|trojan|ss):\/\/[^\s<>"'`]+/gi);
  if (!matches) return [];

  return matches
    .map((link) =>
      link
        .replace(/(?:&quot;|&apos;|&#34;|&#39;)+$/gi, '')
        .replace(/[)\],.;]+$/g, '')
        .trim(),
    )
    .filter((link) => isSupportedLink(link));
}

function parseVlessLink(
  link: string,
  identitySalt?: string,
): VlessConfig | null {
  try {
    const normalizedLink = normalizeLinkForParsing(link);
    const parsedUrl = new URL(normalizedLink);
    if (parsedUrl.protocol !== 'vless:') return null;

    const uuid = safeDecodeComponent(parsedUrl.username || '');
    const address = parsedUrl.hostname || '';
    const port = Number(parsedUrl.port);
    if (
      !uuid ||
      !address ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    )
      return null;

    const name = parsedUrl.hash
      ? safeDecodeComponent(parsedUrl.hash.substring(1)) || 'Server'
      : 'Server';
    const params = parsedUrl.searchParams;

    const typeValue = params.get('type') || 'tcp';
    const securityValue = params.get('security') || 'none';
    const type = (
      ['tcp', 'raw', 'kcp', 'ws', 'http', 'grpc', 'quic', 'xhttp'].includes(
        typeValue,
      )
        ? typeValue
        : 'tcp'
    ) as VlessConfig['type'];
    const security = (
      ['reality', 'tls', 'none'].includes(securityValue)
        ? securityValue
        : 'none'
    ) as VlessConfig['security'];
    const flow = params.get('flow') ?? undefined;
    const encryption = params.get('encryption') ?? undefined;
    const sni = params.get('sni') ?? undefined;
    const fp = params.get('fp') ?? undefined;
    const pbk = params.get('pbk') ?? undefined;
    const sid = params.get('sid') ?? undefined;
    const spx = params.get('spx') ?? undefined;
    const path = params.get('path') ?? undefined;
    const host = params.get('host') ?? undefined;
    const serviceName = params.get('serviceName') ?? undefined;
    const mode = params.get('mode') ?? undefined;
    const xhttpExtra = parseJsonObjectParam(params.get('extra'));
    const noGRPCHeader = parseOptionalBooleanQueryParam(
      params.get('noGRPCHeader'),
    );
    const allowInsecure =
      isTruthyQueryParam(params.get('insecure')) ||
      isTruthyQueryParam(params.get('allowInsecure'));
    const stableId = makeServerIdentity(uuid, address, port, [
      identitySalt,
      type,
      security,
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
      params.get('extra') ?? undefined,
      noGRPCHeader === undefined ? undefined : String(noGRPCHeader),
      String(allowInsecure),
    ]);

    return {
      uuid: stableId,
      userId: uuid,
      address,
      port,
      name,
      encryption,
      type,
      security,
      sni,
      fp,
      pbk,
      sid,
      flow,
      spx,
      path,
      host,
      serviceName,
      mode,
      xhttpExtra,
      noGRPCHeader,
      allowInsecure,
    };
  } catch {
    logger.error('SubscriptionService', 'Error parsing VLESS link', {
      link: link.substring(0, 50) + '...',
    });
    return null;
  }
}

type V2rayPluginParams = {
  network?: 'ws';
  host?: string;
  path?: string;
  security?: 'tls' | 'none';
  sni?: string;
  allowInsecure?: boolean;
  maxEarlyData?: number;
};

function decodeSsBase64(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = normalized.length % 4;
  const padded =
    remainder === 0 ? normalized : normalized + '='.repeat(4 - remainder);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function splitSsCredentials(
  value: string,
): { method: string; password: string } | null {
  const colonIndex = value.indexOf(':');
  if (colonIndex <= 0 || colonIndex >= value.length - 1) {
    return null;
  }
  return {
    method: value.slice(0, colonIndex),
    password: value.slice(colonIndex + 1),
  };
}

function parseSsUserinfo(userinfo: string): { method: string; password: string } | null {
  const decodedUserinfo = safeDecodeComponent(userinfo);
  try {
    const decoded = decodeSsBase64(decodedUserinfo);
    const creds = splitSsCredentials(decoded);
    if (creds?.method) {
      return creds;
    }
  } catch {
    // Fall through to plain method:password userinfo.
  }
  return splitSsCredentials(decodedUserinfo);
}

function parseLegacySsPayload(
  payload: string,
): { method: string; password: string; address: string; port: number } | null {
  let decoded: string;
  try {
    decoded = decodeSsBase64(payload);
  } catch {
    return null;
  }

  const atIndex = decoded.lastIndexOf('@');
  if (atIndex <= 0) {
    return null;
  }

  const creds = splitSsCredentials(decoded.slice(0, atIndex));
  const hostPort = decoded.slice(atIndex + 1);
  const colonIndex = hostPort.lastIndexOf(':');
  if (!creds?.method || colonIndex <= 0) {
    return null;
  }

  const address = hostPort.slice(0, colonIndex);
  const port = Number(hostPort.slice(colonIndex + 1));
  if (
    !address ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    return null;
  }

  return { ...creds, address, port };
}

function parseV2rayPluginParams(
  pluginValue: string | null,
): V2rayPluginParams | null {
  if (!pluginValue) return null;

  const normalized = safeDecodeComponent(pluginValue);
  const segments = normalized.split(';').map((part) => part.trim());
  if (segments.length === 0 || !segments[0]?.startsWith('v2ray-plugin')) {
    return null;
  }

  const params: V2rayPluginParams = {};
  for (const segment of segments.slice(1)) {
    if (!segment) continue;

    const eqIndex = segment.indexOf('=');
    if (eqIndex === -1) {
      if (segment === 'tls') {
        params.security = 'tls';
      }
      continue;
    }

    const key = segment.slice(0, eqIndex).trim().toLowerCase();
    const value = segment.slice(eqIndex + 1).trim();
    switch (key) {
      case 'mode':
        if (value.toLowerCase() === 'websocket' || value.toLowerCase() === 'ws') {
          params.network = 'ws';
        }
        break;
      case 'host':
        params.host = value;
        break;
      case 'path':
        params.path = value;
        break;
      case 'tls':
        if (isTruthyQueryParam(value)) {
          params.security = 'tls';
        }
        break;
      case 'sni':
        params.sni = value;
        break;
      case 'skip-cert-verify':
        if (isTruthyQueryParam(value)) {
          params.allowInsecure = true;
        }
        break;
      case 'ed':
      case 'earlydata':
        params.maxEarlyData = parseOptionalNumberQueryParam(value);
        break;
      default:
        break;
    }
  }

  if (params.security === undefined && segments.includes('tls')) {
    params.security = 'tls';
  }

  return params;
}

function parseShadowsocksLink(link: string): VlessConfig | null {
  try {
    const normalizedLink = normalizeLinkForParsing(link);
    const hashIndex = normalizedLink.indexOf('#');
    const linkWithoutHash =
      hashIndex >= 0 ? normalizedLink.slice(0, hashIndex) : normalizedLink;
    const name =
      hashIndex >= 0
        ? safeDecodeComponent(normalizedLink.slice(hashIndex + 1)) ||
          'Shadowsocks Server'
        : 'Shadowsocks Server';

    const parsedUrl = new URL(linkWithoutHash);
    if (parsedUrl.protocol !== 'ss:') return null;

    let method = '';
    let password = '';
    let address = parsedUrl.hostname || '';
    let port = Number(parsedUrl.port);

    if (address && parsedUrl.username) {
      const creds = parseSsUserinfo(parsedUrl.username);
      if (!creds) return null;
      method = creds.method;
      password = creds.password;
    } else {
      const legacyPayload = linkWithoutHash.slice('ss://'.length);
      const legacy = parseLegacySsPayload(legacyPayload);
      if (!legacy) return null;
      method = legacy.method;
      password = legacy.password;
      address = legacy.address;
      port = legacy.port;
    }

    if (
      !method ||
      !password ||
      !address ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      return null;
    }

    const plugin = parseV2rayPluginParams(parsedUrl.searchParams.get('plugin'));
    const network = plugin?.network ?? 'tcp';
    const security = plugin?.security ?? 'none';
    const sni = plugin?.sni;
    const path = plugin?.path;
    const host = plugin?.host;
    const allowInsecure = plugin?.allowInsecure;
    const maxEarlyData = plugin?.maxEarlyData;

    return {
      uuid: makeServerIdentity(`${method}:${password}`, address, port, [
        network,
        security,
        sni,
        path,
        host,
        maxEarlyData === undefined ? undefined : String(maxEarlyData),
        String(allowInsecure),
      ]),
      address,
      port,
      name,
      protocol: 'shadowsocks',
      method,
      password,
      type: network,
      security,
      sni,
      path,
      host,
      allowInsecure,
      wsMaxEarlyData: maxEarlyData,
    };
  } catch {
    logger.error('SubscriptionService', 'Error parsing Shadowsocks link', {
      link: link.substring(0, 50) + '...',
    });
    return null;
  }
}

function parseTrojanLink(link: string): VlessConfig | null {
  try {
    const normalizedLink = normalizeLinkForParsing(link);
    const parsedUrl = new URL(normalizedLink);
    if (parsedUrl.protocol !== 'trojan:') return null;

    const password = safeDecodeComponent(parsedUrl.username || '');
    const address = parsedUrl.hostname || '';
    const port = Number(parsedUrl.port);
    if (
      !password ||
      !address ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    )
      return null;

    const name = parsedUrl.hash
      ? safeDecodeComponent(parsedUrl.hash.substring(1)) || 'Trojan Server'
      : 'Trojan Server';
    const params = parsedUrl.searchParams;
    const typeParam = params.get('type') || '';
    const network = (
      ['tcp', 'ws', 'grpc'].includes(typeParam) ? typeParam : 'tcp'
    ) as 'tcp' | 'ws' | 'grpc';
    const security = (
      (params.get('security') || 'tls') === 'none' ? 'none' : 'tls'
    ) as 'tls' | 'none';
    const level = parseOptionalNumberQueryParam(params.get('level'));

    // Structured fields only — rely on ConfigGenerator to produce a complete
    // Xray configuration (inbounds, block/direct outbounds, routing rules)
    // instead of a half-baked rawConfig that would crash Xray once routing
    // references `outboundTag: "block"` / `"direct"`.
    return {
      uuid: makeServerIdentity(password || 'trojan', address, port, [
        network,
        security,
        params.get('sni') || '',
        params.get('fp') || '',
        params.get('path') || '',
        params.get('host') || '',
        params.get('serviceName') || '',
        params.get('email') || '',
        level === undefined ? undefined : String(level),
        String(
          isTruthyQueryParam(params.get('insecure')) ||
            isTruthyQueryParam(params.get('allowInsecure')),
        ),
      ]),
      address,
      port,
      name,
      protocol: 'trojan',
      password,
      email: params.get('email') ?? undefined,
      level,
      type: network,
      security,
      sni: params.get('sni') ?? undefined,
      fp: params.get('fp') ?? undefined,
      path: params.get('path') ?? undefined,
      host: params.get('host') ?? undefined,
      serviceName: params.get('serviceName') ?? undefined,
      allowInsecure:
        isTruthyQueryParam(params.get('insecure')) ||
        isTruthyQueryParam(params.get('allowInsecure')),
    };
  } catch {
    logger.error('SubscriptionService', 'Error parsing Trojan link', {
      link: link.substring(0, 50) + '...',
    });
    return null;
  }
}

function parseLink(link: string, identitySalt?: string): VlessConfig | null {
  if (link.startsWith('vless://')) {
    return parseVlessLink(link, identitySalt);
  }
  if (link.startsWith('trojan://')) {
    return parseTrojanLink(link);
  }
  if (link.startsWith('ss://')) {
    return parseShadowsocksLink(link);
  }
  return null;
}

export function parseDirectLinksFromText(input: string): VlessConfig[] {
  const candidates = extractSupportedLinks(input);
  if (candidates.length === 0) {
    return [];
  }

  const configs: VlessConfig[] = [];
  for (const [index, line] of candidates.entries()) {
    const config = parseLink(line, `${index}:${line}`);
    if (config) configs.push(config);
  }
  return configs;
}
