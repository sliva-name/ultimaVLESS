import { APP_CONSTANTS } from '@/shared/constants';
import type { XrayConfig } from '@/shared/xray-types';

/**
 * Session traffic counters. With `api.listen` Xray serves the gRPC API on its
 * own loopback socket, so no inbound, routing rule or `api` outbound is needed.
 * Only the proxy outbound's counters are read (`outbound>>>proxy>>>…`).
 * @see https://xtls.github.io/config/api.html
 * @see https://xtls.github.io/config/stats.html
 */
export function applyStatsApi(
  cfg: XrayConfig,
  apiPort: number = APP_CONSTANTS.PORTS.API,
): void {
  cfg.stats = cfg.stats ?? {};
  // Always overwrite: a subscription-supplied api.services (e.g. HandlerService)
  // would otherwise be served on the client's loopback port.
  cfg.api = {
    tag: 'api',
    listen: `127.0.0.1:${apiPort}`,
    services: ['StatsService'],
  };

  const policy = (cfg.policy ?? {}) as Record<string, unknown>;
  const system = (policy.system as Record<string, unknown>) ?? {};
  policy.system = {
    ...system,
    statsOutboundUplink: true,
    statsOutboundDownlink: true,
  };
  cfg.policy = policy;
}
