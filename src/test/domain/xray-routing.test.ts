import { describe, expect, it } from 'vitest';
import { DEFAULT_PERFORMANCE_SETTINGS } from '@/shared/types';
import { buildBypassRules, buildDefaultRoutingRules } from '@/main/services/configGenerator/routing';

describe('buildBypassRules', () => {
  it('emits nothing when no exclusions are configured', () => {
    expect(
      buildBypassRules({
        ...DEFAULT_PERFORMANCE_SETTINGS,
        bypassDomains: [],
        bypassIps: [],
      }),
    ).toEqual([]);
  });

  it('ships vk.com as a default exclusion', () => {
    expect(buildBypassRules(DEFAULT_PERFORMANCE_SETTINGS)).toEqual([
      {
        type: 'field',
        domain: ['domain:vk.com'],
        outboundTag: 'direct',
      },
    ]);
  });

  it('maps bare hosts to domain matchers and keeps address entries verbatim', () => {
    expect(
      buildBypassRules({
        ...DEFAULT_PERFORMANCE_SETTINGS,
        bypassDomains: ['example.com', 'full:a.example.com'],
        bypassIps: ['10.0.0.0/8', 'geoip:private'],
      }),
    ).toEqual([
      {
        type: 'field',
        domain: ['domain:example.com', 'full:a.example.com'],
        outboundTag: 'direct',
      },
      {
        type: 'field',
        ip: ['10.0.0.0/8', 'geoip:private'],
        outboundTag: 'direct',
      },
    ]);
  });
});

describe('buildDefaultRoutingRules', () => {
  it('places exclusions after block rules and before the catch-all proxy rule', () => {
    const rules = buildDefaultRoutingRules({
      ...DEFAULT_PERFORMANCE_SETTINGS,
      blockAds: true,
      bypassDomains: ['example.com'],
    });

    const outboundTags = rules.map((rule) => rule.outboundTag);
    expect(outboundTags).toEqual(['block', 'direct', 'direct', 'proxy']);
    expect(rules[1]).toEqual({
      type: 'field',
      domain: ['domain:example.com'],
      outboundTag: 'direct',
    });
    expect(rules[rules.length - 1]).toEqual({
      type: 'field',
      port: '0-65535',
      outboundTag: 'proxy',
    });
  });
});
