/** Bundled Xray-core release (see scripts/prepare-xray-assets.mjs). */
export const BUNDLED_XRAY_VERSION = 'v26.7.28';

/**
 * Passed to the instance that UltimaVLESS starts for itself when it needs
 * Administrator rights. It marks a launch that must keep booting instead of
 * handing activation back to the instance it is replacing.
 */
export const RELAUNCH_ARG = '--ultima-relaunch';

export const APP_CONSTANTS = {
  PORTS: {
    SOCKS: 10808,
    HTTP: 10809,
    /**
     * Loopback port Xray exposes its internal gRPC API on while running.
     * Used by the TrafficStatsService to poll StatsService counters.
     */
    API: 10810,
    /** Idle slot used to bring up a second Xray during transactional proxy switch. */
    STAGING_SOCKS: 10818,
    STAGING_HTTP: 10819,
    STAGING_API: 10820,
  },
  TIMEOUTS: {
    SUBSCRIPTION_FETCH: 10000,
  },
};

export interface RuntimePorts {
  socks: number;
  http: number;
  api: number;
}

export const PRIMARY_RUNTIME_PORTS: RuntimePorts = {
  socks: APP_CONSTANTS.PORTS.SOCKS,
  http: APP_CONSTANTS.PORTS.HTTP,
  api: APP_CONSTANTS.PORTS.API,
};

export const STAGING_RUNTIME_PORTS: RuntimePorts = {
  socks: APP_CONSTANTS.PORTS.STAGING_SOCKS,
  http: APP_CONSTANTS.PORTS.STAGING_HTTP,
  api: APP_CONSTANTS.PORTS.STAGING_API,
};

export function otherRuntimePorts(current: RuntimePorts): RuntimePorts {
  return current.socks === PRIMARY_RUNTIME_PORTS.socks
    ? { ...STAGING_RUNTIME_PORTS }
    : { ...PRIMARY_RUNTIME_PORTS };
}
