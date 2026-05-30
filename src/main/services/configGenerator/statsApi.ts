import { APP_CONSTANTS } from '@/shared/constants';
import type { XrayConfig, XrayRoutingRule } from '@/shared/xray-types';
import type { MutableInbound } from './inbounds';

type MutableConfigNode = Record<string, unknown>;
type MutableOutbound = MutableConfigNode & {
  protocol?: string;
  tag?: string;
  settings?: MutableConfigNode;
};

export function applyStatsApi(cfg: XrayConfig): void {
  cfg.stats = cfg.stats ?? {};
  cfg.api = cfg.api ?? { tag: 'api', services: ['StatsService'] };

  const policy = (cfg.policy ?? {}) as Record<string, unknown>;
  const levels =
    (policy.levels as Record<string, Record<string, unknown>>) ?? {};
  const levelZero = levels['0'] ?? {};
  levels['0'] = {
    ...levelZero,
    statsUserUplink: true,
    statsUserDownlink: true,
  };
  const system = (policy.system as Record<string, unknown>) ?? {};
  policy.levels = levels;
  policy.system = {
    ...system,
    statsInboundUplink: true,
    statsInboundDownlink: true,
    statsOutboundUplink: true,
    statsOutboundDownlink: true,
  };
  cfg.policy = policy;

  if (!Array.isArray(cfg.inbounds)) {
    cfg.inbounds = [];
  }
  const inbounds = cfg.inbounds as MutableInbound[];
  if (!inbounds.some((ib) => ib?.tag === 'api')) {
    inbounds.push({
      tag: 'api',
      port: APP_CONSTANTS.PORTS.API,
      listen: '127.0.0.1',
      protocol: 'tunnel',
      settings: { rewriteAddress: '127.0.0.1' },
    });
  }

  if (!Array.isArray(cfg.outbounds)) cfg.outbounds = [];
  const outbounds = cfg.outbounds as MutableOutbound[];
  if (!outbounds.some((o) => o?.tag === 'api')) {
    outbounds.push({ tag: 'api', protocol: 'freedom', settings: {} });
  }

  if (!cfg.routing || typeof cfg.routing !== 'object') {
    cfg.routing = { domainStrategy: 'AsIs', rules: [] };
  }
  if (!Array.isArray(cfg.routing.rules)) {
    cfg.routing.rules = [];
  }
  const rules = cfg.routing.rules as XrayRoutingRule[];
  const hasApiRule = rules.some(
    (r) => r && Array.isArray(r.inboundTag) && r.inboundTag.includes('api'),
  );
  const apiRule = hasApiRule
    ? rules.find(
        (r) => r && Array.isArray(r.inboundTag) && r.inboundTag.includes('api'),
      )
    : { type: 'field', inboundTag: ['api'], outboundTag: 'api' };
  const nonApiRules = rules.filter(
    (r) => !(r && Array.isArray(r.inboundTag) && r.inboundTag.includes('api')),
  );

  cfg.routing.rules = [apiRule, ...nonApiRules] as XrayRoutingRule[];
}
