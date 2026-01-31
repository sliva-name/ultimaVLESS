import { describe, it, expect } from 'vitest';
import { ConfigGenerator } from './ConfigGenerator';
import { VlessConfig } from '../../shared/types';

describe('ConfigGenerator', () => {
  const mockConfig: VlessConfig = {
    uuid: '123-uuid',
    address: 'example.com',
    port: 443,
    name: 'Test Server',
    type: 'tcp',
    security: 'reality',
    flow: 'xtls-rprx-vision',
    sni: 'example.com',
    fp: 'chrome',
    pbk: 'public-key',
    sid: 'short-id',
  };

  it('should generate valid Xray config for VLESS Reality', () => {
    const logPath = '/tmp/xray.log';
    const result = ConfigGenerator.generate(mockConfig, logPath);

    expect(result.log.access).toBe(logPath);
    expect(result.outbounds?.[0].protocol).toBe('vless');
    expect(result.outbounds?.[0].streamSettings?.security).toBe('reality');
    expect(result.outbounds?.[0].streamSettings?.realitySettings?.publicKey).toBe('public-key');
    expect(result.outbounds?.[0].streamSettings?.realitySettings?.shortId).toBe('short-id');
  });

  it('should handle TLS security', () => {
    const tlsConfig: VlessConfig = {
        ...mockConfig,
        security: 'tls',
        sid: undefined,
        pbk: undefined,
        fp: undefined
    };
    
    const result = ConfigGenerator.generate(tlsConfig, '/tmp/log');
    expect(result.outbounds?.[0].streamSettings?.security).toBe('tls');
    expect(result.outbounds?.[0].streamSettings?.tlsSettings?.serverName).toBe('example.com');
  });

  it('should set default fingerprint if missing', () => {
    const noFpConfig = { ...mockConfig, fp: undefined };
    const result = ConfigGenerator.generate(noFpConfig, '/tmp/log');
    expect(result.outbounds?.[0].streamSettings?.realitySettings?.fingerprint).toBe('chrome');
  });
});

