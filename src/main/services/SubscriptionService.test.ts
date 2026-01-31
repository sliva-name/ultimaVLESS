import { describe, it, expect, vi } from 'vitest';
import { SubscriptionService } from './SubscriptionService';
import axios from 'axios';
import { encode } from 'js-base64';

vi.mock('axios');

describe('SubscriptionService', () => {
  const service = new SubscriptionService();
  const mockVlessLink = 'vless://uuid@example.com:443?type=tcp&security=reality&sni=example.com&fp=chrome&pbk=key&sid=123#TestServer';
  
  it('should fetch and parse a valid subscription', async () => {
    const encodedBody = encode(mockVlessLink + '\n');
    (axios.get as any).mockResolvedValue({ data: encodedBody });

    const configs = await service.fetchAndParse('https://sub.url');
    
    expect(configs).toHaveLength(1);
    expect(configs[0].name).toBe('TestServer');
    expect(configs[0].address).toBe('example.com');
    expect(configs[0].security).toBe('reality');
  });

  it('should handle multiple links', async () => {
    const link2 = 'vless://uuid2@test.com:443?type=ws&security=tls#Server2';
    const encodedBody = encode(mockVlessLink + '\n' + link2);
    (axios.get as any).mockResolvedValue({ data: encodedBody });

    const configs = await service.fetchAndParse('https://sub.url');
    expect(configs).toHaveLength(2);
    expect(configs[1].type).toBe('ws');
  });

  it('should throw error on invalid base64', async () => {
    (axios.get as any).mockResolvedValue({ data: 'invalid-base-64%%' });
    await expect(service.fetchAndParse('https://sub.url')).rejects.toThrow();
  });
});

