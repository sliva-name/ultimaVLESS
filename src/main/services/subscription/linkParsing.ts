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

export function isSupportedLink(link: string): boolean {
  return link.startsWith('vless://') || link.startsWith('trojan://');
}

export function extractSupportedLinks(input: string): string[] {
  // Stop before common HTML delimiters so links embedded in markup are still valid.
  const matches = input.match(/(?:vless|trojan):\/\/[^\s<>"'`]+/gi);
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

function parseVlessLink(link: string): VlessConfig | null {
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
      ['tcp', 'raw', 'kcp', 'ws', 'http', 'grpc', 'quic'].includes(typeValue)
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
    const stableId = makeServerIdentity(uuid, address, port, [
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

function parseLink(link: string): VlessConfig | null {
  if (link.startsWith('vless://')) {
    return parseVlessLink(link);
  }
  if (link.startsWith('trojan://')) {
    return parseTrojanLink(link);
  }
  return null;
}

export function parseDirectLinksFromText(input: string): VlessConfig[] {
  const candidates = extractSupportedLinks(input);
  if (candidates.length === 0) {
    return [];
  }

  const configs: VlessConfig[] = [];
  for (const line of candidates) {
    const config = parseLink(line);
    if (config) configs.push(config);
  }
  return configs;
}
