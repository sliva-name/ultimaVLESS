/**
 * Connection health monitor timing. Tunable without touching probe logic.
 *
 * Tunnel auto-switch timeline (worst case, all probes fail):
 * initialDelay + (streak - 1) * interval + autoSwitchDelay
 * e.g. 5s + 15s + 2s ≈ 22s (was ~95s with 30s×3 + 5s).
 */
export const CONNECTION_MONITOR_TIMING = {
  /** Periodic health tick while connected. */
  healthCheckIntervalMs: 15_000,
  /** First tick after connect (lets Xray listeners settle). */
  healthCheckInitialDelayMs: 5_000,
  /**
   * Consecutive failed HTTP tunnel probes before treating the server as
   * blocked and scheduling auto-switch.
   */
  tunnelProbeStreakBeforeAction: 2,
  /** Consecutive local proxy probe failures before surfacing to the user. */
  localProxyStreakBeforeNotify: 2,
  /** Delay after a blocking error before {@link attemptAutoSwitch}. */
  autoSwitchDelayMs: 2_000,
  /** Faster tunnel probe during background health checks (not post-switch validation). */
  healthTunnelProbeTimeoutMs: 6_000,
  healthTunnelProbeAttempts: 2,
  healthTunnelProbeGapMs: 200,
} as const;
