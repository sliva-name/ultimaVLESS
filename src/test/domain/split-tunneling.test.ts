import { describe, expect, it } from 'vitest';
import {
  MAX_SPLIT_TUNNEL_ENTRIES,
  classifySplitTunnelEntry,
  normalizeBypassDomains,
  normalizeBypassIps,
  toXrayDomainMatcher,
} from '@/shared/splitTunneling';

describe('classifySplitTunnelEntry', () => {
  it('reduces pasted addresses to a bare host', () => {
    expect(classifySplitTunnelEntry('https://Example.com/login?a=1')).toEqual({
      kind: 'domain',
      value: 'example.com',
    });
    expect(classifySplitTunnelEntry('user@mail.example.com:8443')).toEqual({
      kind: 'domain',
      value: 'mail.example.com',
    });
    expect(classifySplitTunnelEntry('  *.Example.com.  ')).toEqual({
      kind: 'domain',
      value: 'example.com',
    });
  });

  it('punycodes internationalized hosts', () => {
    expect(classifySplitTunnelEntry('почта.рф')).toEqual({
      kind: 'domain',
      value: 'xn--80a1acny.xn--p1ai',
    });
  });

  it('keeps Xray matchers that are already explicit', () => {
    expect(classifySplitTunnelEntry('full:a.example.com')).toEqual({
      kind: 'domain',
      value: 'full:a.example.com',
    });
    expect(classifySplitTunnelEntry('geosite:category-ru')).toEqual({
      kind: 'domain',
      value: 'geosite:category-ru',
    });
    expect(classifySplitTunnelEntry('geoip:private')).toEqual({
      kind: 'ip',
      value: 'geoip:private',
    });
  });

  it('classifies addresses and CIDR blocks as ip entries', () => {
    expect(classifySplitTunnelEntry('192.168.10.5')).toEqual({
      kind: 'ip',
      value: '192.168.10.5',
    });
    expect(classifySplitTunnelEntry('10.0.0.0/8')).toEqual({
      kind: 'ip',
      value: '10.0.0.0/8',
    });
    expect(classifySplitTunnelEntry('[2001:db8::1]')).toEqual({
      kind: 'ip',
      value: '2001:db8::1',
    });
    expect(classifySplitTunnelEntry('2001:db8::/32')).toEqual({
      kind: 'ip',
      value: '2001:db8::/32',
    });
  });

  it('rejects regexp matchers and other unusable input', () => {
    expect(classifySplitTunnelEntry('regexp:.*\\.example\\.com')).toBeNull();
    expect(classifySplitTunnelEntry('')).toBeNull();
    expect(classifySplitTunnelEntry('   ')).toBeNull();
    expect(classifySplitTunnelEntry('domain:')).toBeNull();
    expect(classifySplitTunnelEntry('geosite:')).toBeNull();
    expect(classifySplitTunnelEntry('exam ple.com')).toBeNull();
    expect(classifySplitTunnelEntry('-example.com')).toBeNull();
    expect(classifySplitTunnelEntry(42)).toBeNull();
    expect(classifySplitTunnelEntry('a'.repeat(300))).toBeNull();
  });
});

describe('normalizeBypassDomains / normalizeBypassIps', () => {
  it('splits the two kinds apart and drops duplicates', () => {
    const input = ['example.com', 'EXAMPLE.com', '1.2.3.4', 'junk entry'];
    expect(normalizeBypassDomains(input)).toEqual(['example.com']);
    expect(normalizeBypassIps(input)).toEqual(['1.2.3.4']);
  });

  it('caps the list length', () => {
    const many = Array.from(
      { length: MAX_SPLIT_TUNNEL_ENTRIES + 20 },
      (_, i) => `host${i}.example.com`,
    );
    expect(normalizeBypassDomains(many)).toHaveLength(MAX_SPLIT_TUNNEL_ENTRIES);
  });

  it('ignores non-array input', () => {
    expect(normalizeBypassDomains('example.com')).toEqual([]);
    expect(normalizeBypassIps(undefined)).toEqual([]);
  });
});

describe('toXrayDomainMatcher', () => {
  it('expands bare hosts to cover subdomains and passes matchers through', () => {
    expect(toXrayDomainMatcher('example.com')).toBe('domain:example.com');
    expect(toXrayDomainMatcher('full:a.example.com')).toBe(
      'full:a.example.com',
    );
    expect(toXrayDomainMatcher('geosite:category-ru')).toBe(
      'geosite:category-ru',
    );
  });
});
