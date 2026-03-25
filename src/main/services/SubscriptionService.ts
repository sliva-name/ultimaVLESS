import { decode, isValid } from 'js-base64';
import net from 'net';
import { VlessConfig } from '../../shared/types';
import { logger } from './LoggerService';

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}
function makeStableId(address: string, port: number, userUUID: string): string {
  return `${userUUID.substring(0, 8)}-${address}:${port}`;
}

function redactUrlForLogs(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return '[invalid-url]';
  }
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;

  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) {
    const octets = normalized.split('.').map(Number);
    if (octets.length !== 4 || octets.some((value) => Number.isNaN(value))) return false;
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  if (ipVersion === 6) {
    return normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }

  return false;
}

export class SubscriptionService {
  private static readonly MAX_RESPONSE_BODY_LENGTH = 5_000_000;

  private validateRemoteSubscriptionUrl(rawUrl: string): URL {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      throw new Error('Invalid subscription URL');
    }

    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      throw new Error('Only HTTP(S) subscription URLs are allowed');
    }

    if (isPrivateOrLoopbackHost(parsedUrl.hostname)) {
      throw new Error('Subscription URL host is not allowed');
    }

    return parsedUrl;
  }

  public async fetchAndParse(url: string): Promise<VlessConfig[]> {
    logger.info('SubscriptionService', 'fetchAndParse called', { redactedUrl: redactUrlForLogs(url) });
    try {
      const directConfigs = this.parseDirectLinksFromText(url);
      if (directConfigs.length > 0) {
        logger.info('SubscriptionService', 'Detected direct link input', { count: directConfigs.length });
        return directConfigs;
      }

      const validatedUrl = this.validateRemoteSubscriptionUrl(url);
      const response = await fetchWithTimeout(validatedUrl.toString(), 15000);
      if (!response.ok) {
        throw new Error(`Subscription request failed: HTTP ${response.status}`);
      }
      const contentLengthHeader = response.headers?.get?.('content-length');
      if (contentLengthHeader) {
        const contentLength = Number(contentLengthHeader);
        if (!Number.isNaN(contentLength) && contentLength > SubscriptionService.MAX_RESPONSE_BODY_LENGTH) {
          throw new Error('Subscription response is too large');
        }
      }
      const rawText = await response.text();
      if (rawText.length > SubscriptionService.MAX_RESPONSE_BODY_LENGTH) {
        throw new Error('Subscription response is too large');
      }
      if (!rawText.trim()) {
        throw new Error('Empty response from subscription URL');
      }

      const trimmed = rawText.trim();
      let body: string | unknown[] | Record<string, unknown>;
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
          body = JSON.parse(trimmed) as unknown[] | Record<string, unknown>;
        } catch {
          body = rawText;
        }
      } else {
        body = rawText;
      }

      if (typeof body === 'object' && Array.isArray(body)) {
        logger.info('SubscriptionService', 'Detected JSON array format', { count: body.length });
        return this.parseJsonConfigs(body);
      }

      if (typeof body === 'string') {
        const trimmed = body.trim();

        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
          try {
            const parsed = JSON.parse(trimmed);
            const arr = Array.isArray(parsed) ? parsed : [parsed];
            logger.info('SubscriptionService', 'Detected JSON string format', { count: arr.length });
            return this.parseJsonConfigs(arr);
          } catch {
            // Not valid JSON, try base64
          }
        }

        return this.parseBase64(trimmed);
      }

      throw new Error(`Unsupported response type: ${typeof body}`);
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.error('SubscriptionService', 'fetchAndParse failed', e);
      throw e;
    }
  }

  public parseDirectLinksFromText(input: string): VlessConfig[] {
    const candidates = this.extractSupportedLinks(input);
    if (candidates.length === 0) {
      return [];
    }

    const configs: VlessConfig[] = [];
    for (const line of candidates) {
      const config = this.parseLink(line);
      if (config) configs.push(config);
    }
    return configs;
  }

  private extractSupportedLinks(input: string): string[] {
    const matches = input.match(/(?:vless|trojan|hysteria2):\/\/\S+/gi);
    if (!matches) return [];

    return matches
      .map((link) => link.replace(/[)\],.;]+$/g, '').trim())
      .filter((link) => this.isSupportedLink(link));
  }

  private isSupportedLink(line: string): boolean {
    return line.startsWith('vless://') || line.startsWith('trojan://') || line.startsWith('hysteria2://');
  }

  private parseLink(link: string): VlessConfig | null {
    if (link.startsWith('vless://')) {
      return this.parseVlessLink(link);
    }
    if (link.startsWith('trojan://')) {
      return this.parseTrojanLink(link);
    }
    if (link.startsWith('hysteria2://')) {
      return this.parseHysteria2Link(link);
    }
    return null;
  }

  private parseJsonConfigs(configs: any[]): VlessConfig[] {
    const results: VlessConfig[] = [];

    for (const cfg of configs) {
      try {
        const name = cfg.remarks || cfg.ps || 'Server';
        const proxyOutbound = (cfg.outbounds || []).find(
          (o: any) => o.tag === 'proxy' || o.protocol === 'vless' || o.protocol === 'vmess'
        );

        if (!proxyOutbound) {
          logger.warn('SubscriptionService', 'No proxy outbound found', { name });
          continue;
        }

        let address = '';
        let port = 0;
        let userUUID = '';
        let flow = '';
        let encryption = 'none';

        const vnext = proxyOutbound.settings?.vnext;
        if (vnext && vnext.length > 0) {
          address = vnext[0].address || '';
          port = vnext[0].port || 0;
          const users = vnext[0].users;
          if (users && users.length > 0) {
            userUUID = users[0].id || '';
            flow = users[0].flow || '';
            encryption = users[0].encryption || 'none';
          }
        }

        if (!address || !port) {
          logger.warn('SubscriptionService', 'Missing address/port', { name });
          continue;
        }

        const stream = proxyOutbound.streamSettings || {};
        const network = stream.network || 'tcp';
        const security = stream.security || 'none';

        let sni = '';
        let fp = '';
        let pbk = '';
        let sid = '';
        let spx = '';
        let path = '';
        let host = '';
        let serviceName = '';

        if (security === 'reality' && stream.realitySettings) {
          const rs = stream.realitySettings;
          sni = rs.serverName || '';
          fp = rs.fingerprint || '';
          pbk = rs.publicKey || '';
          sid = rs.shortId || '';
          spx = rs.spiderX || '';
        } else if (security === 'tls' && stream.tlsSettings) {
          const ts = stream.tlsSettings;
          sni = ts.serverName || '';
          fp = ts.fingerprint || '';
        }

        if (stream.wsSettings) {
          path = stream.wsSettings.path || '';
          host = stream.wsSettings.headers?.Host || '';
        }
        if (stream.grpcSettings) {
          serviceName = stream.grpcSettings.serviceName || '';
        }

        const networkType = (['tcp', 'kcp', 'ws', 'http', 'grpc', 'quic'].includes(network) ? network : undefined) as VlessConfig['type'];
        const secType = (['reality', 'tls', 'none'].includes(security) ? security : undefined) as VlessConfig['security'];
        const stableId = makeStableId(address, port, userUUID);

        results.push({
          uuid: stableId,
          address,
          port,
          name,
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
          rawConfig: cfg,
        });
      } catch (e) {
        logger.error('SubscriptionService', 'Error parsing JSON config', e);
      }
    }

    logger.info('SubscriptionService', 'Parsed JSON configs', { count: results.length });
    return results;
  }

  private parseBase64(base64Body: string): VlessConfig[] {
    const cleanBase64 = base64Body.replace(/\s/g, '');
    if (!isValid(cleanBase64)) {
      throw new Error('Invalid Base64 response');
    }

    let decoded = '';
    try {
      decoded = decode(cleanBase64);
      logger.info('SubscriptionService', 'Decoded base64', { length: decoded.length });
    } catch (e) {
      const error = e instanceof Error ? e : new Error('Base64 decode failed');
      logger.error('SubscriptionService', 'Decode failed', error);
      throw error;
    }

    const lines = decoded.split('\n').filter((line) => line.trim() !== '');
    const configs: VlessConfig[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!this.isSupportedLink(trimmed)) continue;
      const config = this.parseLink(trimmed);
      if (config) configs.push(config);
    }

    logger.info('SubscriptionService', 'Parsed base64 configs', { count: configs.length });
    return configs;
  }

  private parseVlessLink(link: string): VlessConfig | null {
    try {
      const uri = link.substring(8);
      if (!uri.includes('@') || !uri.includes(':')) return null;
      const [addressPart, queryPart] = uri.split('?');
      if (!addressPart) return null;

      const lastAt = addressPart.lastIndexOf('@');
      const uuid = addressPart.substring(0, lastAt);
      const hostPort = addressPart.substring(lastAt + 1);
      const lastColon = hostPort.lastIndexOf(':');
      const address = hostPort.substring(0, lastColon);
      const port = parseInt(hostPort.substring(lastColon + 1), 10);

      let paramsPart = queryPart || '';
      let name = 'Server';
      if (paramsPart.includes('#')) {
        const parts = paramsPart.split('#');
        paramsPart = parts[0];
        name = parts[1] ? decodeURIComponent(parts[1]) : 'Server';
      }

      const params: Record<string, string> = {};
      if (paramsPart) {
        paramsPart.split('&').forEach((p) => {
          const [key, val] = p.split('=');
          if (key && val) params[key] = decodeURIComponent(val);
        });
      }

      const type = (['tcp', 'kcp', 'ws', 'http', 'grpc', 'quic'].includes(params.type || '') ? params.type : 'tcp') as VlessConfig['type'];
      const security = (['reality', 'tls', 'none'].includes(params.security || '') ? params.security : 'none') as VlessConfig['security'];
      return {
        uuid,
        address,
        port,
        name,
        encryption: params.encryption,
        type,
        security,
        sni: params.sni,
        fp: params.fp,
        pbk: params.pbk,
        sid: params.sid,
        flow: params.flow,
        spx: params.spx,
        path: params.path,
        host: params.host,
        serviceName: params.serviceName,
      };
    } catch {
      logger.error('SubscriptionService', 'Error parsing VLESS link', { link: link.substring(0, 50) + '...' });
      return null;
    }
  }

  private parseTrojanLink(link: string): VlessConfig | null {
    try {
      const uri = link.substring('trojan://'.length);
      const [beforeQuery, queryAndHash = ''] = uri.split('?');
      if (!beforeQuery) return null;
      const lastAt = beforeQuery.lastIndexOf('@');
      if (lastAt <= 0) return null;

      const password = decodeURIComponent(beforeQuery.substring(0, lastAt));
      const hostPort = beforeQuery.substring(lastAt + 1).replace(/\/+$/, '');
      const lastColon = hostPort.lastIndexOf(':');
      if (lastColon <= 0) return null;

      const address = hostPort.substring(0, lastColon);
      const port = parseInt(hostPort.substring(lastColon + 1), 10);
      if (!address || Number.isNaN(port) || port <= 0) return null;

      let paramsPart = queryAndHash;
      let name = 'Trojan Server';
      if (paramsPart.includes('#')) {
        const parts = paramsPart.split('#');
        paramsPart = parts[0];
        name = parts[1] ? decodeURIComponent(parts[1]) : name;
      }

      const params: Record<string, string> = {};
      if (paramsPart) {
        paramsPart.split('&').forEach((p) => {
          const [key, val = ''] = p.split('=');
          if (key) params[key] = decodeURIComponent(val);
        });
      }

      const network = (['tcp', 'ws', 'grpc'].includes(params.type || '') ? params.type : 'tcp') as 'tcp' | 'ws' | 'grpc';
      const security = (params.security || 'tls') as 'tls' | 'none';

      const streamSettings: Record<string, any> = { network, security };
      if (security === 'tls') {
        streamSettings.tlsSettings = {
          serverName: params.sni || '',
          allowInsecure: params.insecure === '1' || params.allowInsecure === '1',
          fingerprint: params.fp || undefined,
        };
      }
      if (network === 'ws') {
        streamSettings.wsSettings = {
          path: params.path || '/',
          headers: { Host: params.host || params.sni || '' },
        };
      } else if (network === 'grpc') {
        streamSettings.grpcSettings = { serviceName: params.serviceName || '' };
      }

      const rawConfig = {
        outbounds: [{
          tag: 'proxy',
          protocol: 'trojan',
          settings: { servers: [{ address, port, password }] },
          streamSettings,
        }],
      };

      return {
        uuid: makeStableId(address, port, password || 'trojan'),
        address,
        port,
        name,
        type: network,
        security,
        sni: params.sni,
        fp: params.fp,
        path: params.path,
        host: params.host,
        serviceName: params.serviceName,
        rawConfig,
      };
    } catch {
      logger.error('SubscriptionService', 'Error parsing Trojan link', { link: link.substring(0, 50) + '...' });
      return null;
    }
  }

  private parseHysteria2Link(link: string): VlessConfig | null {
    try {
      const uri = link.substring('hysteria2://'.length);
      const [beforeQuery, queryAndHash = ''] = uri.split('?');
      if (!beforeQuery) return null;
      const lastAt = beforeQuery.lastIndexOf('@');
      if (lastAt <= 0) return null;

      const password = decodeURIComponent(beforeQuery.substring(0, lastAt));
      const hostPort = beforeQuery.substring(lastAt + 1).replace(/\/+$/, '');
      const lastColon = hostPort.lastIndexOf(':');
      if (lastColon <= 0) return null;

      const address = hostPort.substring(0, lastColon);
      const port = parseInt(hostPort.substring(lastColon + 1), 10);
      if (!address || Number.isNaN(port) || port <= 0) return null;

      let paramsPart = queryAndHash;
      let name = 'Hysteria2 Server';
      if (paramsPart.includes('#')) {
        const parts = paramsPart.split('#');
        paramsPart = parts[0];
        name = parts[1] ? decodeURIComponent(parts[1]) : name;
      }

      const params: Record<string, string> = {};
      if (paramsPart) {
        paramsPart.split('&').forEach((p) => {
          const [key, val = ''] = p.split('=');
          if (key) params[key] = decodeURIComponent(val);
        });
      }

      const allowInsecure = params.insecure === '1' || params.allowInsecure === '1';
      const sni = params.sni || '';
      const rawConfig = {
        outbounds: [{
          tag: 'proxy',
          protocol: 'hysteria2',
          settings: { servers: [{ address, port }], password },
          streamSettings: {
            network: 'tcp',
            security: 'tls',
            tlsSettings: { serverName: sni, allowInsecure },
          },
        }],
      };

      return {
        uuid: makeStableId(address, port, password || 'hy2'),
        address,
        port,
        name,
        type: 'tcp',
        security: 'tls',
        sni,
        rawConfig,
      };
    } catch {
      logger.error('SubscriptionService', 'Error parsing Hysteria2 link', { link: link.substring(0, 50) + '...' });
      return null;
    }
  }
}

export const subscriptionService = new SubscriptionService();
