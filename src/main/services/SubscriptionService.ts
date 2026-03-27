import { decode, isValid } from 'js-base64';
import net from 'net';
import { VlessConfig } from '../../shared/types';
import { logger } from './LoggerService';
import { parseJsonConfigs } from './subscription/jsonParsing';
import { extractSupportedLinks, parseDirectLinksFromText } from './subscription/linkParsing';

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
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
  private static readonly FETCH_TIMEOUT_MS = 30_000;

  public extractSupportedLinksFromText(input: string): string[] {
    return extractSupportedLinks(input);
  }

  public parseDirectLinksFromText(input: string): VlessConfig[] {
    return parseDirectLinksFromText(input);
  }

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

  public async fetchAndParseDetailed(url: string): Promise<{ configs: VlessConfig[]; extractedLinks: string[] }> {
    logger.info('SubscriptionService', 'fetchAndParse called', { redactedUrl: redactUrlForLogs(url) });
    try {
      const directLinksFromInput = this.extractSupportedLinksFromText(url);
      if (directLinksFromInput.length > 0) {
        const directConfigs = this.parseDirectLinksFromText(url);
        logger.info('SubscriptionService', 'Detected direct link input', { count: directConfigs.length });
        return {
          configs: directConfigs,
          extractedLinks: directLinksFromInput,
        };
      }

      const validatedUrl = this.validateRemoteSubscriptionUrl(url);
      const response = await fetchWithTimeout(validatedUrl.toString(), SubscriptionService.FETCH_TIMEOUT_MS);
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
        return {
          configs: parseJsonConfigs(body),
          extractedLinks: [],
        };
      }

      if (typeof body === 'string') {
        const textBody = body.trim();
        const directLinksFromBody = this.extractSupportedLinksFromText(textBody);
        if (directLinksFromBody.length > 0) {
          logger.info('SubscriptionService', 'Detected direct links in response body', {
            count: directLinksFromBody.length,
          });
          return {
            configs: this.parseDirectLinksFromText(textBody),
            extractedLinks: directLinksFromBody,
          };
        }

        if (textBody.startsWith('[') || textBody.startsWith('{')) {
          try {
            const parsed = JSON.parse(textBody);
            const arr = Array.isArray(parsed) ? parsed : [parsed];
            logger.info('SubscriptionService', 'Detected JSON string format', { count: arr.length });
            return {
              configs: parseJsonConfigs(arr),
              extractedLinks: [],
            };
          } catch {
            // Not valid JSON, try base64
          }
        }

        const cleanBase64 = textBody.replace(/\s/g, '');
        if (!isValid(cleanBase64)) {
          throw new Error('Invalid Base64 response');
        }
        const decoded = decode(cleanBase64);
        return {
          configs: this.parseBase64(textBody),
          extractedLinks: this.extractSupportedLinksFromText(decoded),
        };
      }

      throw new Error(`Unsupported response type: ${typeof body}`);
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.error('SubscriptionService', 'fetchAndParse failed', e);
      throw e;
    }
  }

  public async fetchAndParse(url: string): Promise<VlessConfig[]> {
    const result = await this.fetchAndParseDetailed(url);
    return result.configs;
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
    } catch (error) {
      const decodeError = error instanceof Error ? error : new Error('Base64 decode failed');
      logger.error('SubscriptionService', 'Decode failed', decodeError);
      throw decodeError;
    }

    const configs = parseDirectLinksFromText(decoded);
    logger.info('SubscriptionService', 'Parsed base64 configs', { count: configs.length });
    return configs;
  }
}

export const subscriptionService = new SubscriptionService();
