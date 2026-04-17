export const APP_CONSTANTS = {
  PORTS: {
    SOCKS: 10808,
    HTTP: 10809,
    /**
     * Loopback port Xray exposes its internal gRPC API on while running.
     * Used by the TrafficStatsService to poll StatsService counters.
     */
    API: 10810,
  },
  TIMEOUTS: {
    SUBSCRIPTION_FETCH: 10000,
  },
};

