import { decode, isValid } from 'js-base64';
import axios from 'axios';
import { VlessConfig } from '../../shared/types';
import { logger } from './LoggerService';

/**
 * Service for fetching and parsing VLESS subscriptions.
 */
export class SubscriptionService {
  
  /**
   * Fetches the subscription from a URL and parses it into VlessConfig objects.
   * Supports base64 encoded responses containing multiple vless:// links.
   * 
   * @param {string} url - The subscription URL to fetch.
   * @returns {Promise<VlessConfig[]>} Array of parsed VLESS configurations.
   * @throws {Error} If fetch fails, response is empty, or base64 is invalid.
   */
  public async fetchAndParse(url: string): Promise<VlessConfig[]> {
    logger.info('SubscriptionService', 'fetchAndParse called', { url });
    try {
      const response = await axios.get(url, { timeout: 10000 });
      const base64Body = response.data;
      
      if (!base64Body) {
        throw new Error('Empty response from subscription URL');
      }

      // Handle standard base64 issues (newlines, etc)
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
      
      const lines = decoded.split('\n').filter(line => line.trim() !== '');
      const configs: VlessConfig[] = [];

      for (const line of lines) {
        if (line.startsWith('vless://')) {
          const config = this.parseVlessLink(line);
          if (config) {
            configs.push(config);
          }
        }
        // Add other protocols (vmess, trojan) here if needed
      }

      logger.info('SubscriptionService', 'Parsed configs', { count: configs.length });
      return configs;
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.error('SubscriptionService', 'fetchAndParse failed', e);
      throw e;
    }
  }

  /**
   * Parses a single vless:// link into a VlessConfig object.
   * 
   * @param {string} link - The vless:// link string.
   * @returns {VlessConfig | null} The parsed config or null if invalid.
   */
  private parseVlessLink(link: string): VlessConfig | null {
    try {
      // link: vless://uuid@host:port?params#name
      const uri = link.substring(8); // remove vless://
      if (!uri.includes('@') || !uri.includes(':')) {
        return null;
      }

      // Split by ? to separate address from params
      const [addressPart, queryPart] = uri.split('?');
      if (!addressPart) return null;

      // Address part: uuid@host:port
      const lastAt = addressPart.lastIndexOf('@');
      const uuid = addressPart.substring(0, lastAt);
      const hostPort = addressPart.substring(lastAt + 1);
      
      const lastColon = hostPort.lastIndexOf(':');
      const address = hostPort.substring(0, lastColon);
      const portStr = hostPort.substring(lastColon + 1);
      const port = parseInt(portStr, 10);

      // Query part: params#name
      let paramsPart = queryPart || '';
      let name = 'Server';
      
      if (paramsPart.includes('#')) {
        const parts = paramsPart.split('#');
        paramsPart = parts[0];
        name = parts[1] ? decodeURIComponent(parts[1]) : 'Server';
      }

      const params: Record<string, string> = {};
      if (paramsPart) {
        paramsPart.split('&').forEach(p => {
          const [key, val] = p.split('=');
          if (key && val) {
            params[key] = decodeURIComponent(val);
          }
        });
      }

      // Helper to cast strict types safely
      const type = (['tcp', 'kcp', 'ws', 'http', 'grpc', 'quic'].includes(params.type || '') ? params.type : 'tcp') as VlessConfig['type'];
      const security = (['reality', 'tls', 'none'].includes(params.security || '') ? params.security : 'none') as VlessConfig['security'];
      
      const config: VlessConfig = {
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
        serviceName: params.serviceName
      };

      return config;

    } catch (e) {
      logger.error('SubscriptionService', 'Error parsing VLESS link', { link: link.substring(0, 50) + '...', error: e });
      return null;
    }
  }
}

export const subscriptionService = new SubscriptionService();
