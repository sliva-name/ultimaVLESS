import { VlessConfig } from '@/shared/types';
import {
  createHashedIdentityToken,
  createStableServerId,
} from '@/shared/serverIdentity';
import { logger } from '@/main/services/LoggerService';
import {
  addUdpMasks,
  hasUdpMask,
  isDialingUdpMask,
  migrateLegacyUdpHop,
} from '@/main/services/configGenerator/outboundCompat';
import { redactUrl } from '@/main/utils/redactUrl';
import { unbracketIpv6 } from '@/shared/networkAddresses';

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
  params: URLSearchParams,
  name: string,
): Record<string, unknown> | undefined {
  const value = params.get(name);
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Only the name: the value can hold obfs passwords.
    logger.warn('SubscriptionService', 'Ignoring invalid JSON query param', {
      param: name,
    });
  }
  return undefined;
}

/**
 * Panels such as 3x-ui put the server's whole `streamSettings.finalmask`
 * (`tcp`, `udp`, `quicParams`) into `fm` as JSON. Masks stay out of server
 * ids: a refresh then keeps an already imported server selected.
 */
function parseFinalmaskParam(
  params: URLSearchParams,
): Record<string, unknown> | undefined {
  const finalmask = parseJsonObjectParam(params, 'fm');
  // Turn a legacy hop into its mask now, so it wins over link hop params.
  if (finalmask) migrateLegacyUdpHop(finalmask);
  return finalmask;
}

/**
 * Validates a port list as Xray's `PortList` reads it (`443`,
 * `20000-30000`, `443,20000-30000`) and returns its first port.
 */
function firstPortOfList(value: string): number | null {
  let first: number | null = null;
  for (const item of value.split(',')) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const match = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(trimmed);
    if (!match) return null;
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (from < 1 || to > 65535 || from > to) return null;
    first ??= from;
  }
  return first;
}

/** Port hopping as a `udphop` mask, unless the finalmask dials by itself. */
function withUdpHop(
  finalmask: Record<string, unknown> | undefined,
  settings: Record<string, unknown>,
): Record<string, unknown> {
  if (Array.isArray(finalmask?.udp) && finalmask.udp.some(isDialingUdpMask)) {
    return finalmask;
  }
  const next = finalmask ?? {};
  addUdpMasks(next, [{ type: 'udphop', settings }]);
  return next;
}

const KCP_HEADER_MASKS = new Map([
  ['dns', 'dns'],
  ['dtls', 'dtls'],
  ['srtp', 'srtp'],
  ['utp', 'utp'],
  ['wechat-video', 'wechat'],
  ['wireguard', 'wireguard'],
]);

/**
 * Xray 26 ignores `kcpSettings.header`/`seed`; legacy mKCP obfuscation now
 * comes from `mkcp-legacy` UDP masks. Seed goes first so the header wraps
 * the cipher on the wire. `mkcp-legacy` masks from `fm` win.
 */
function withMkcpLegacyMasks(
  finalmask: Record<string, unknown> | undefined,
  params: URLSearchParams,
): Record<string, unknown> | undefined {
  const headerType = (params.get('headerType') ?? '').trim().toLowerCase();
  const seed = params.get('seed') ?? '';
  const hasHeader = headerType !== '' && headerType !== 'none';
  if (!hasHeader && !seed) return finalmask;
  if (hasUdpMask(finalmask, 'mkcp-legacy')) return finalmask;
  const header = hasHeader ? KCP_HEADER_MASKS.get(headerType) : '';
  // Xray rejects an unknown header outright.
  if (header === undefined) return finalmask;

  const masks: unknown[] = [];
  if (seed) {
    masks.push({ type: 'mkcp-legacy', settings: { header: '', value: seed } });
  }
  if (header) {
    masks.push({ type: 'mkcp-legacy', settings: { header, value: '' } });
  }
  const next = finalmask ?? {};
  addUdpMasks(next, masks);
  return next;
}

export function isSupportedLink(link: string): boolean {
  const normalized = link.toLowerCase();
  return (
    normalized.startsWith('vless://') ||
    normalized.startsWith('trojan://') ||
    normalized.startsWith('ss://') ||
    normalized.startsWith('hy2://') ||
    normalized.startsWith('hysteria2://')
  );
}

export function extractSupportedLinks(input: string): string[] {
  // Stop before common HTML delimiters so links embedded in markup are still valid.
  const matches = input.match(
    /(?:vless|trojan|ss|hy2|hysteria2):\/\/[^\s<>"'`]+/gi,
  );
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

const LINK_TRANSPORTS: readonly string[] = [
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
];

/** `alpn=h2,http/1.1` — comma-separated, as the share-link standard has it. */
function parseAlpnParam(value: string | null): string[] | undefined {
  if (!value) return undefined;
  const alpn = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return alpn.length > 0 ? alpn : undefined;
}

type LinkStreamParams = Pick<
  VlessConfig,
  | 'type'
  | 'security'
  | 'sni'
  | 'fp'
  | 'pbk'
  | 'sid'
  | 'spx'
  | 'path'
  | 'host'
  | 'serviceName'
  | 'authority'
  | 'mode'
  | 'xhttpExtra'
  | 'noGRPCHeader'
  | 'allowInsecure'
  | 'alpn'
  | 'headerType'
  | 'pinnedPeerCertSha256'
  | 'verifyPeerCertByName'
  | 'mldsa65Verify'
  | 'echConfigList'
  | 'finalmask'
>;

/**
 * Transport and TLS/REALITY parameters. The share-link standard is written
 * for VLESS/VMess, but panels (3x-ui, Marzban, Remnawave) put the same ones on
 * trojan:// links, REALITY and XHTTP included.
 * @see https://github.com/XTLS/Xray-core/discussions/716
 */
function parseLinkStreamParams(
  params: URLSearchParams,
  defaultSecurity: 'tls' | 'none',
): LinkStreamParams {
  const typeValue = params.get('type') || 'tcp';
  const type = (
    LINK_TRANSPORTS.includes(typeValue) ? typeValue : 'tcp'
  ) as VlessConfig['type'];
  const securityValue = params.get('security') || defaultSecurity;
  const security = (
    ['reality', 'tls', 'none'].includes(securityValue)
      ? securityValue
      : defaultSecurity
  ) as VlessConfig['security'];
  const fm = parseFinalmaskParam(params);
  // v2rayN / 3x-ui export RAW HTTP camouflage as `headerType=http`; for mKCP
  // the same parameter names a legacy header mask.
  const isRaw = type === 'tcp' || type === 'raw';
  const headerType = (params.get('headerType') ?? '').trim().toLowerCase();
  return {
    type,
    security,
    sni: params.get('sni') ?? undefined,
    fp: params.get('fp') ?? undefined,
    pbk: params.get('pbk') ?? undefined,
    sid: params.get('sid') ?? undefined,
    spx: params.get('spx') ?? undefined,
    path: params.get('path') ?? undefined,
    host: params.get('host') ?? undefined,
    serviceName: params.get('serviceName') ?? undefined,
    authority: params.get('authority') || undefined,
    mode: params.get('mode') ?? undefined,
    xhttpExtra: parseJsonObjectParam(params, 'extra'),
    noGRPCHeader: parseOptionalBooleanQueryParam(params.get('noGRPCHeader')),
    allowInsecure:
      isTruthyQueryParam(params.get('insecure')) ||
      isTruthyQueryParam(params.get('allowInsecure')),
    alpn: parseAlpnParam(params.get('alpn')),
    headerType: isRaw && headerType === 'http' ? 'http' : undefined,
    pinnedPeerCertSha256:
      params.get('pinnedPeerCertSha256') ?? params.get('pcs') ?? undefined,
    verifyPeerCertByName:
      params.get('verifyPeerCertByName') ?? params.get('vcn') ?? undefined,
    mldsa65Verify:
      params.get('mldsa65Verify') ?? params.get('pqv') ?? undefined,
    echConfigList: params.get('ech') ?? undefined,
    finalmask:
      type === 'kcp' || type === 'mkcp' ? withMkcpLegacyMasks(fm, params) : fm,
  };
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
    // Ids keep the bracketed form so existing IPv6 servers keep theirs.
    const idHost = parsedUrl.hostname || '';
    const address = unbracketIpv6(idHost);
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

    const stream = parseLinkStreamParams(params, 'none');
    const {
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
      authority,
      mode,
      noGRPCHeader,
      allowInsecure,
    } = stream;
    const flow = params.get('flow') ?? undefined;
    const encryption = params.get('encryption') ?? undefined;
    const stableId = createStableServerId(uuid, idHost, port, [
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
      // Appended last and only when set so existing server ids stay stable.
      ...(authority ? [authority] : []),
    ]);

    return {
      ...stream,
      uuid: stableId,
      userId: uuid,
      address,
      port,
      name,
      encryption,
      flow,
    };
  } catch {
    logger.error('SubscriptionService', 'Error parsing VLESS link', {
      link: redactUrl(link),
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
    const idHost = parsedUrl.hostname || '';
    const address = unbracketIpv6(idHost);
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
    const stream = parseLinkStreamParams(params, 'tls');
    const { type, security } = stream;

    // Earlier builds read only tcp/ws/grpc and TLS; those links keep their id.
    const legacyNetwork =
      type === 'ws' || type === 'grpc'
        ? type
        : type === 'tcp' || type === 'raw'
          ? 'tcp'
          : undefined;
    const idParts = [
      legacyNetwork ?? 'tcp',
      security === 'none' ? 'none' : 'tls',
      params.get('sni') || '',
      params.get('fp') || '',
      params.get('path') || '',
      params.get('host') || '',
      params.get('serviceName') || '',
      String(stream.allowInsecure),
      // Appended last and only when set so existing server ids stay stable.
      ...(stream.authority ? [stream.authority] : []),
      ...(legacyNetwork
        ? []
        : [`type:${type}`, stream.mode, params.get('extra')]),
      ...(security === 'reality'
        ? ['reality', stream.pbk, stream.sid, stream.spx]
        : []),
    ];

    // Structured fields only; the runtime compiler adds inbounds, auxiliary
    // outbounds, and routing rules so imported links cannot produce half-baked
    // raw configs that crash Xray.
    return {
      ...stream,
      uuid: createStableServerId(
        createHashedIdentityToken('tj', password || 'trojan', idHost, port),
        idHost,
        port,
        idParts,
      ),
      address,
      port,
      name,
      protocol: 'trojan',
      password,
    };
  } catch {
    logger.error('SubscriptionService', 'Error parsing Trojan link', {
      link: redactUrl(link),
    });
    return null;
  }
}

/**
 * The Hysteria 2 URI may list several ports for port hopping
 * (`host:443,20000-30000`), which URL() rejects. Returns the link with just
 * the first port, plus the full list.
 */
function splitHysteria2Ports(link: string): { link: string; ports?: string } {
  const schemeEnd = link.indexOf('//');
  if (schemeEnd < 0) return { link };
  const authorityStart = schemeEnd + 2;
  const rest = link.slice(authorityStart);
  const authorityEnd = rest.search(/[/?#]/);
  const authority = authorityEnd < 0 ? rest : rest.slice(0, authorityEnd);
  const hostStart = authority.lastIndexOf('@') + 1;
  const hostPort = authority.slice(hostStart);
  const colon = hostPort.startsWith('[')
    ? hostPort.indexOf(']:') + 1
    : hostPort.indexOf(':');
  if (colon <= 0) return { link };
  const ports = hostPort.slice(colon + 1);
  const first = /[,-]/.test(ports) ? firstPortOfList(ports) : null;
  // A malformed list stays as is, so URL() refuses the link like before.
  if (first === null) return { link };
  const portStart = authorityStart + hostStart + colon + 1;
  return {
    link:
      link.slice(0, portStart) +
      String(first) +
      link.slice(portStart + ports.length),
    ports,
  };
}

/** Gecko obfs pads packets to `minPacketSize`-`maxPacketSize` bytes. */
function parseGeckoPacketSize(params: URLSearchParams): string | undefined {
  const min = (params.get('minPacketSize') ?? '').trim();
  const max = (params.get('maxPacketSize') ?? '').trim();
  if (!/^\d+$/.test(min) || !/^\d+$/.test(max)) return undefined;
  const from = Number(min);
  const to = Number(max);
  // Bounds of Xray's salamander `packetSize`.
  return from >= 1 && from <= to && to <= 2048 ? `${from}-${to}` : undefined;
}

/**
 * Official Hysteria 2 URI: hy2:// / hysteria2://
 * https://hysteria.network/docs/developers/URI-Scheme/
 */
function parseHysteria2Link(link: string): VlessConfig | null {
  try {
    const normalizedLink = normalizeLinkForParsing(link);
    // URL() does not recognize hy2: — normalize to hysteria2: for parsing.
    const split = splitHysteria2Ports(
      normalizedLink.replace(/^hy2:/i, 'hysteria2:'),
    );
    const parsedUrl = new URL(split.link);
    if (parsedUrl.protocol !== 'hysteria2:') return null;

    const auth = safeDecodeComponent(parsedUrl.username || '');
    const idHost = parsedUrl.hostname || '';
    const address = unbracketIpv6(idHost);
    const port = parsedUrl.port ? Number(parsedUrl.port) : 443;
    if (
      !auth ||
      !address ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      return null;
    }

    const name = parsedUrl.hash
      ? safeDecodeComponent(parsedUrl.hash.substring(1)) || 'Hysteria Server'
      : 'Hysteria Server';
    const params = parsedUrl.searchParams;
    const allowInsecure =
      isTruthyQueryParam(params.get('insecure')) ||
      isTruthyQueryParam(params.get('allowInsecure'));
    const obfs = params.get('obfs') ?? undefined;
    const obfsPassword = params.get('obfs-password') ?? undefined;
    const sni = params.get('sni') ?? undefined;
    const fp = params.get('fp') ?? undefined;
    const echConfigList = params.get('ech') ?? undefined;
    const pinnedPeerCertSha256 =
      params.get('pinSHA256') ??
      params.get('pinnedPeerCertSha256') ??
      params.get('pcs') ??
      undefined;
    const packetSize =
      obfs?.toLowerCase() === 'gecko'
        ? parseGeckoPacketSize(params)
        : undefined;

    let finalmask = parseFinalmaskParam(params);
    const mport = params.get('mport') ?? '';
    if (split.ports) {
      // The official client hops to a new local socket and server port every
      // 30 s, Xray's default interval.
      finalmask = withUdpHop(finalmask, {
        mode: 'intervalLocal,intervalRemote',
        remotePorts: split.ports,
      });
    } else if (firstPortOfList(mport) !== null) {
      // v2rayN / 3x-ui extension.
      finalmask = withUdpHop(finalmask, {
        mode: 'intervalremote',
        interval: '5-10',
        remotePorts: mport,
      });
    }

    return {
      // Hop ports and gecko sizes stay out of the id, like the masks.
      uuid: createStableServerId(
        createHashedIdentityToken('hy2', auth, idHost, port),
        idHost,
        port,
        [
          'hysteria',
          sni,
          fp,
          obfs,
          obfsPassword,
          echConfigList,
          pinnedPeerCertSha256,
          String(allowInsecure),
        ],
      ),
      address,
      port,
      name,
      protocol: 'hysteria',
      password: auth,
      hysteriaAuth: auth,
      type: 'hysteria',
      security: 'tls',
      sni,
      fp,
      allowInsecure,
      pinnedPeerCertSha256,
      verifyPeerCertByName:
        params.get('verifyPeerCertByName') ?? params.get('vcn') ?? undefined,
      echConfigList,
      hysteriaObfs:
        obfs || obfsPassword
          ? {
              type: obfs,
              password: obfsPassword,
              ...(packetSize ? { packetSize } : {}),
            }
          : undefined,
      finalmask,
    };
  } catch {
    logger.error('SubscriptionService', 'Error parsing Hysteria2 link', {
      link: redactUrl(link),
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
      address: unbracketIpv6(parsed.address),
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
      finalmask: parseFinalmaskParam(params),
    };
  } catch {
    logger.error('SubscriptionService', 'Error parsing Shadowsocks link', {
      link: redactUrl(link),
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
  if (
    normalized.startsWith('hy2://') ||
    normalized.startsWith('hysteria2://')
  ) {
    return parseHysteria2Link(link);
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
