import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SubscriptionService } from './SubscriptionService';
import { encode } from 'js-base64';

function mockFetchText(body: string, ok = true, status = 200) {
  vi.mocked(globalThis.fetch).mockResolvedValue({
    ok,
    status,
    text: async () => body,
  } as Response);
}

describe('SubscriptionService', () => {
  const service = new SubscriptionService();
  const mockVlessLink = 'vless://uuid@example.com:443?type=tcp&security=reality&sni=example.com&fp=chrome&pbk=key&sid=123#TestServer';

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should fetch and parse a valid subscription', async () => {
    const encodedBody = encode(mockVlessLink + '\n');
    mockFetchText(encodedBody);

    const configs = await service.fetchAndParse('https://sub.url');
    
    expect(configs).toHaveLength(1);
    expect(configs[0].name).toBe('TestServer');
    expect(configs[0].address).toBe('example.com');
    expect(configs[0].security).toBe('reality');
  });

  it('should handle multiple links', async () => {
    const link2 = 'vless://uuid2@test.com:443?type=ws&security=tls#Server2';
    const encodedBody = encode(mockVlessLink + '\n' + link2);
    mockFetchText(encodedBody);

    const configs = await service.fetchAndParse('https://sub.url');
    expect(configs).toHaveLength(2);
    expect(configs[1].type).toBe('ws');
  });

  it('should throw error on invalid base64', async () => {
    mockFetchText('invalid-base-64%%');
    await expect(service.fetchAndParse('https://sub.url')).rejects.toThrow();
  });

  it('should reject non-http(s) subscription urls', async () => {
    await expect(service.fetchAndParse('file:///etc/passwd')).rejects.toThrow(/Only HTTP\(S\)/);
  });

  it('should reject localhost subscription host', async () => {
    await expect(service.fetchAndParse('http://127.0.0.1/sub')).rejects.toThrow(/host is not allowed/);
  });
});

