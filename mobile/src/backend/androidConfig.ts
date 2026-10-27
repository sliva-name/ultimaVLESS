import type { ConnectionMode, PerformanceSettings } from '@/shared/types';
import type { XrayConfig } from '@/shared/xray-types';
import {
  TUN_ADDRESS,
  TUN_IPV6_ADDRESS,
  TUN_IPV6_PREFIX,
  TUN_PREFIX,
} from '@/main/services/tunRoute/constants';
import type { VpnOptions } from '../native/UltimaCore';

/**
 * What changes when the desktop Xray config runs inside an Android VpnService.
 *
 * Apps are routed by the VpnService itself (allowed / disallowed packages),
 * not by Xray `process` rules: Android hides other apps' sockets from
 * `/proc/net`, so those rules would never match. The app's own package always
 * bypasses the VPN, which keeps Xray's outbound sockets, the probes and the
 * subscription fetches off the tunnel without `protect()` calls.
 */
export interface AndroidRoutingPlan {
  /** Settings the config compiler gets. */
  performanceSettings: PerformanceSettings;
  allowedApps: string[];
  disallowedApps: string[];
}

export function planAndroidRouting(
  perf: PerformanceSettings,
  mode: ConnectionMode,
): AndroidRoutingPlan {
  const directApps = [...perf.directApps];
  const tunnelledApps = perf.proxyApps.filter(
    (app) => !directApps.includes(app),
  );
  const compiled: PerformanceSettings = {
    ...perf,
    proxyApps: [],
    directApps: [],
    // TCP_FASTOPEN_CONNECT is refused on part of the Android kernels and
    // Xray then fails the dial instead of falling back.
    tcpFastOpen: false,
  };

  if (mode !== 'tun') {
    // Without a VPN nothing tells apps apart, and whatever an app sends to
    // the local proxy was pointed there to be proxied.
    return {
      performanceSettings: {
        ...compiled,
        routingMode: perf.routingMode === 'apps' ? 'all' : perf.routingMode,
      },
      allowedApps: [],
      disallowedApps: [],
    };
  }

  if (perf.routingMode === 'apps' && tunnelledApps.length > 0) {
    // Only the chosen apps enter the tunnel, so inside it everything is
    // theirs: route it like `all` (exclusions and LAN still go direct).
    return {
      performanceSettings: { ...compiled, routingMode: 'all' },
      allowedApps: tunnelledApps,
      disallowedApps: [],
    };
  }

  return {
    performanceSettings: compiled,
    allowedApps: [],
    disallowedApps: directApps,
  };
}

/**
 * TUN fields Android leaves to the VpnService (addresses, routes, DNS).
 * `name` stays: without it Xray picks a free interface name through netlink,
 * which Android 11+ denies to apps ("netlinkrib: permission denied").
 */
const DESKTOP_ONLY_TUN_SETTINGS = [
  'gateway',
  'dns',
  'autoOutboundsInterface',
  'autoSystemRoutingTable',
  'autoSystemWfpBlockLeak',
  'autoSystemDnsToGateway',
];

/**
 * The compiled desktop config, minus what has no place in an app process:
 * the gRPC stats listener (traffic is read in-process) and the TUN settings
 * that would make Xray configure interfaces and routes itself.
 */
export function adaptConfigForAndroid(config: XrayConfig): XrayConfig {
  const adapted = structuredClone(config);
  delete adapted.api;
  for (const inbound of adapted.inbounds ?? []) {
    if (inbound?.protocol !== 'tun' || !inbound.settings) continue;
    const settings = { ...(inbound.settings as Record<string, unknown>) };
    for (const key of DESKTOP_ONLY_TUN_SETTINGS) delete settings[key];
    inbound.settings = settings;
  }
  return adapted;
}

export function buildVpnOptions(
  perf: PerformanceSettings,
  plan: AndroidRoutingPlan,
): VpnOptions {
  return {
    mtu: perf.tunMtu,
    ipv4Address: TUN_ADDRESS,
    ipv4Prefix: TUN_PREFIX,
    ipv6Address: TUN_IPV6_ADDRESS,
    ipv6Prefix: TUN_IPV6_PREFIX,
    dnsServers:
      perf.remoteDnsServers.length > 0
        ? [...perf.remoteDnsServers]
        : ['1.1.1.1', '1.0.0.1'],
    allowedApps: plan.allowedApps,
    disallowedApps: plan.disallowedApps,
  };
}
