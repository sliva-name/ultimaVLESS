import { VlessConfig } from '@/shared/types';
import {
  createHashedIdentityToken,
  createStableServerId,
} from '@/shared/serverIdentity';
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

function parseOptionalIntegerQueryParam(
  value: string | null,
): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeLinkForParsing(link: string): string {
  return link.trim().replace(/&amp;/gi, '&');
}

function decodeBase64Url(value: string): string | null {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    '=',
  );
  try {
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function parseMethodPassword(value: string): {
  method: string;
  password: string;
} | null {
  const colonIndex = value.indexOf(':');
  if (colonIndex <= 0) return null;
  const method = value.slice(0, colonIndex);
  const password = value.slice(colonIndex + 1);
  if (!method || !password) return null;
  return { method, password };
}

function parsePluginParams(value: string | null): Map<string, string> {
  const params = new Map<string, string>();
  if (!value) return params;
  for (const part of value.split(';')) {
    if (!part) continue;
    const equalsIndex = part.indexOf('=');
    if (equalsIndex < 0) {
      params.set(part.toLowerCase(), 'true');
      continue;
    }
    const key = part.slice(0, equalsIndex).toLowerCase();
    const rawValue = part.slice(equalsIndex + 1);
    params.set(key, safeDecodeComponent(rawValue));
  }
  return params;
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
  const normalized = link.toLowerCase();
  return (
    normalized.startsWith('vless://') ||
    normalized.startsWith('trojan://') ||
    normalized.startsWith('ss://')
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
    // `vless://uuid@host?...` without an explicit port defaults to 443.
    const port = parsedUrl.port ? Number(parsedUrl.port) : 443;
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
      ].includes(typeValue)
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
    const stableId = createStableServerId(uuid, address, port, [
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
      pinnedPeerCertSha256: params.get('pinnedPeerCertSha256') ?? undefined,
      verifyPeerCertByName: params.get('verifyPeerCertByName') ?? undefined,
    };
  } catch {
    logger.error('SubscriptionService', 'Error parsing VLESS link', {
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

    // Structured fields only; the runtime compiler adds inbounds, auxiliary
    // outbounds, and routing rules so imported links cannot produce half-baked
    // raw configs that crash Xray.
    return {
      uuid: createStableServerId(
        createHashedIdentityToken('tj', password || 'trojan', address, port),
        address,
        port,
        [
          network,
          security,
          params.get('sni') || '',
          params.get('fp') || '',
          params.get('path') || '',
          params.get('host') || '',
          params.get('serviceName') || '',
          String(
            isTruthyQueryParam(params.get('insecure')) ||
              isTruthyQueryParam(params.get('allowInsecure')),
          ),
        ],
      ),
      address,
      port,
      name,
      protocol: 'trojan',
      password,
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
      pinnedPeerCertSha256: params.get('pinnedPeerCertSha256') ?? undefined,
      verifyPeerCertByName: params.get('verifyPeerCertByName') ?? undefined,
    };
  } catch {
    logger.error('SubscriptionService', 'Error parsing Trojan link', {
      link: link.substring(0, 50) + '...',
    });
    return null;
  }
}

function parseShadowsocksCredentials(
  normalizedLink: string,
  parsedUrl: URL,
): { method: string; password: string; address: string; port: number } | null {
  const address = parsedUrl.hostname || '';
  const port = Number(parsedUrl.port);
  const encodedUserInfo = safeDecodeComponent(
    parsedUrl.password
      ? `${parsedUrl.username}:${parsedUrl.password}`
      : parsedUrl.username || '',
  );
  const decodedUserInfo = decodeBase64Url(encodedUserInfo);
  const credentials =
    (decodedUserInfo ? parseMethodPassword(decodedUserInfo) : null) ??
    parseMethodPassword(encodedUserInfo);
  if (credentials && address && Number.isInteger(port)) {
    return { ...credentials, address, port };
  }

  const withoutSchemeAndFragment = normalizedLink
    .slice('ss://'.length)
    .split('#', 1)[0]!
    .split('?', 1)[0]!;
  const decodedFull = decodeBase64Url(withoutSchemeAndFragment);
  if (!decodedFull) return null;
  const atIndex = decodedFull.lastIndexOf('@');
  if (atIndex <= 0) return null;
  const decodedCredentials = parseMethodPassword(decodedFull.slice(0, atIndex));
  if (!decodedCredentials) return null;
  const endpoint = decodedFull.slice(atIndex + 1);
  const endpointUrl = new URL(`ss://${endpoint}`);
  const decodedPort = Number(endpointUrl.port);
  return {
    ...decodedCredentials,
    address: endpointUrl.hostname || '',
    port: decodedPort,
  };
}

function parseShadowsocksLink(link: string): VlessConfig | null {
  try {
    const normalizedLink = normalizeLinkForParsing(link);
    const parsedUrl = new URL(normalizedLink);
    if (parsedUrl.protocol !== 'ss:') return null;

    const parsed = parseShadowsocksCredentials(normalizedLink, parsedUrl);
    if (
      !parsed ||
      !parsed.method ||
      !parsed.password ||
      !parsed.address ||
      !Number.isInteger(parsed.port) ||
      parsed.port < 1 ||
      parsed.port > 65535
    ) {
      return null;
    }

    const name = parsedUrl.hash
      ? safeDecodeComponent(parsedUrl.hash.substring(1)) || 'Shadowsocks Server'
      : 'Shadowsocks Server';
    const params = parsedUrl.searchParams;
    const pluginParams = parsePluginParams(params.get('plugin'));
    const mode = (pluginParams.get('mode') || params.get('type') || '')
      .toLowerCase()
      .trim();
    const isWebSocket =
      mode === 'websocket' ||
      mode === 'ws' ||
      pluginParams.has('tls') ||
      params.get('type') === 'ws';
    const host = pluginParams.get('host') || params.get('host') || undefined;
    const path = pluginParams.get('path') || params.get('path') || undefined;
    const sni = pluginParams.get('sni') || params.get('sni') || host;
    const wsMaxEarlyData =
      parseOptionalIntegerQueryParam(pluginParams.get('ed') ?? null) ??
      parseOptionalIntegerQueryParam(params.get('ed'));
    const allowInsecure =
      isTruthyQueryParam(pluginParams.get('skip-cert-verify') ?? null) ||
      isTruthyQueryParam(params.get('insecure')) ||
      isTruthyQueryParam(params.get('allowInsecure'));
    const security =
      pluginParams.has('tls') || params.get('security') === 'tls'
        ? 'tls'
        : 'none';
    const type = isWebSocket ? 'ws' : 'tcp';

    const uuid = createStableServerId(
      createHashedIdentityToken(
        'ss',
        `${parsed.method}:${parsed.password}`,
        parsed.address,
        parsed.port,
      ),
      parsed.address,
      parsed.port,
      [
        parsed.method,
        type,
        security,
        sni,
        host,
        path,
        wsMaxEarlyData === undefined ? undefined : String(wsMaxEarlyData),
        String(allowInsecure),
        params.get('plugin') ?? undefined,
      ],
    );

    return {
      uuid,
      address: parsed.address,
      port: parsed.port,
      name,
      protocol: 'shadowsocks',
      method: parsed.method,
      password: parsed.password,
      type,
      security,
      sni,
      host,
      path,
      wsMaxEarlyData,
      allowInsecure,
      pinnedPeerCertSha256: params.get('pinnedPeerCertSha256') ?? undefined,
      verifyPeerCertByName: params.get('verifyPeerCertByName') ?? undefined,
    };
  } catch {
    logger.error('SubscriptionService', 'Error parsing Shadowsocks link', {
      link: link.substring(0, 50) + '...',
    });
    return null;
  }
}

function parseLink(link: string, identitySalt?: string): VlessConfig | null {
  const normalized = link.toLowerCase();
  if (normalized.startsWith('vless://')) {
    return parseVlessLink(link, identitySalt);
  }
  if (normalized.startsWith('trojan://')) {
    return parseTrojanLink(link);
  }
  if (normalized.startsWith('ss://')) {
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
