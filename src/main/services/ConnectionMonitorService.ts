import { VlessConfig } from '@/shared/types';
import { isSameServerIdentity } from '@/shared/serverIdentity';
import { logger } from './LoggerService';
import { configService } from './ConfigService';
import { EventEmitter } from 'events';
import { app } from 'electron';
import path from 'path';
import { extractBlockingErrors, isBlockingErrorText } from './blockingErrors';
import { xrayService } from './XrayService';
import { ConnectionHealthState } from '@/shared/ipc';
import { runConnectionHealthProbe } from './connectionMonitor/healthProbe';
import { XrayLogCursor } from './connectionMonitor/xrayLogCursor';
import { CONNECTION_MONITOR_TIMING } from './connectionMonitor/timing';
import { HealthCheckGate } from '@/main/runtime/healthCheckGate';

export interface ConnectionStatus {
  isConnected: boolean;
  currentServer: VlessConfig | null;
  lastError: string | null;
  connectionAttempts: number;
  lastConnectionTime: number | null;
  blockedServers: string[];
  lastHealthCheckAt: number | null;
  lastHealthState: ConnectionHealthState;
  lastHealthFailureReason: string | null;
  localProxyReachable: boolean | null;
}

interface InternalConnectionStatus {
  isConnected: boolean;
  currentServer: VlessConfig | null;
  lastError: string | null;
  connectionAttempts: number;
  lastConnectionTime: number | null;
  blockedServers: Set<string>;
  lastHealthCheckAt: number | null;
  lastHealthState: ConnectionHealthState;
  lastHealthFailureReason: string | null;
  localProxyReachable: boolean | null;
}

interface RecordErrorOptions {
  forceBlocking?: boolean;
}

export interface ConnectionEvent {
  type: 'connected' | 'disconnected' | 'error' | 'blocked' | 'switching';
  server: VlessConfig | null;
  error?: string;
  message?: string;
}

export interface HealthFailureEvent {
  server: VlessConfig;
  reason: string;
  blocking: boolean;
}

/**
 * Health monitor: probe → events. It does not switch servers or tear down
 * the network stack. ConnectionManager owns those decisions.
 */
export class ConnectionMonitorService extends EventEmitter {
  private status: InternalConnectionStatus;
  private checkInterval: NodeJS.Timeout | null = null;
  private initialHealthCheckTimer: NodeJS.Timeout | null = null;
  private isAutoSwitchingEnabled: boolean = true;
  private checkIntervalMs: number =
    CONNECTION_MONITOR_TIMING.healthCheckIntervalMs;
  private xrayLogCursor: XrayLogCursor;
  private sessionAbort: AbortController | null = null;
  private readonly healthCheckGate = new HealthCheckGate();
  private tunnelProbeFailStreak: number = 0;
  private localProxyFailStreak: number = 0;
  private autoSwitchFailedAt: Map<string, number> = new Map();
  private static readonly BLOCKED_SERVER_COOLDOWN_MS = 10 * 60 * 1000;
  private static readonly TUNNEL_PROBE_STREAK_BEFORE_NOTIFY =
    CONNECTION_MONITOR_TIMING.tunnelProbeStreakBeforeAction;
  private static readonly LOCAL_PROXY_STREAK_BEFORE_NOTIFY =
    CONNECTION_MONITOR_TIMING.localProxyStreakBeforeNotify;

  constructor() {
    super();
    this.status = {
      isConnected: false,
      currentServer: null,
      lastError: null,
      connectionAttempts: 0,
      lastConnectionTime: null,
      blockedServers: new Set(),
      lastHealthCheckAt: null,
      lastHealthState: 'idle',
      lastHealthFailureReason: null,
      localProxyReachable: null,
    };

    const userDataPath = app.getPath('userData');
    this.xrayLogCursor = new XrayLogCursor(path.join(userDataPath, 'xray.log'));

    logger.info('ConnectionMonitorService', 'Initialized');
  }

  public startMonitoring(server: VlessConfig): void {
    logger.info('ConnectionMonitorService', 'Starting monitoring', {
      serverName: server.name,
      serverAddress: server.address,
    });

    this.replaceSession();
    this.status.currentServer = server;
    this.status.isConnected = true;
    this.status.lastConnectionTime = Date.now();
    this.status.connectionAttempts = 0;
    this.status.lastError = null;
    this.status.lastHealthCheckAt = null;
    this.status.lastHealthState = 'idle';
    this.status.lastHealthFailureReason = null;
    this.status.localProxyReachable = null;
    this.tunnelProbeFailStreak = 0;
    this.localProxyFailStreak = 0;
    this.resetLogCursorToFileEnd();
    this.startPeriodicCheck(this.sessionAbort!.signal);

    this.emit('connected', {
      type: 'connected',
      server,
      message: `Connected to ${server.name}`,
    } as ConnectionEvent);
  }

  public stopMonitoring(
    options: { message?: string; preserveLastError?: boolean } = {},
  ): void {
    const { message = 'Monitoring stopped', preserveLastError = false } =
      options;
    this.replaceSession();
    this.healthCheckGate.reset();
    logger.info('ConnectionMonitorService', 'Stopping monitoring');

    this.status.isConnected = false;
    this.status.currentServer = null;
    this.status.localProxyReachable = null;
    this.tunnelProbeFailStreak = 0;
    this.localProxyFailStreak = 0;
    this.status.lastHealthState = 'idle';
    this.status.lastHealthFailureReason = null;
    if (!preserveLastError) {
      this.status.lastError = null;
    }

    this.emit('disconnected', {
      type: 'disconnected',
      server: null,
      message,
    } as ConnectionEvent);
  }

  public notifySwitching(server: VlessConfig, fromName?: string): void {
    this.emit('switching', {
      type: 'switching',
      server,
      message: fromName
        ? `Switching from ${fromName} to ${server.name}`
        : `Switching to ${server.name}`,
    } as ConnectionEvent);
  }

  public handleUnexpectedDisconnect(error: string): boolean {
    const server = this.status.currentServer;
    if (!this.status.isConnected || !server) {
      return false;
    }

    this.status.lastError = error;
    this.status.connectionAttempts += 1;
    this.status.lastHealthState = 'failed';
    this.status.lastHealthFailureReason = error;
    this.emit('error', {
      type: 'error',
      server,
      error,
      message: `Connection error: ${error}`,
    } as ConnectionEvent);
    this.stopMonitoring({
      message: `Connection lost: ${error}`,
      preserveLastError: true,
    });
    return true;
  }

  public handleCriticalConnectionFailure(
    error: string,
    options: { localProxyReachable?: boolean | null } = {},
  ): boolean {
    if (!this.status.isConnected || !this.status.currentServer) {
      return false;
    }

    if ('localProxyReachable' in options) {
      this.status.localProxyReachable = options.localProxyReachable ?? null;
    }
    this.status.lastHealthCheckAt = Date.now();
    this.tunnelProbeFailStreak = 0;
    this.localProxyFailStreak = 0;

    return this.recordError(error, this.status.currentServer, {
      forceBlocking: true,
    });
  }

  public syncCurrentServer(servers: VlessConfig[]): VlessConfig | null {
    const currentServer = this.status.currentServer;
    if (!currentServer) {
      return null;
    }

    const exact = servers.find((server) => server.uuid === currentServer.uuid);
    if (exact) {
      this.status.currentServer = exact;
      return exact;
    }

    const fuzzy = servers.find((server) =>
      isSameServerIdentity(server, currentServer),
    );

    if (fuzzy) {
      logger.info(
        'ConnectionMonitorService',
        'Tracked server matched by address/port after uuid rotation',
        {
          from: currentServer.uuid.substring(0, 12),
          to: fuzzy.uuid.substring(0, 12),
          address: currentServer.address,
          port: currentServer.port,
        },
      );
      this.status.currentServer = fuzzy;
      return fuzzy;
    }

    this.status.currentServer = null;
    return null;
  }

  public recordError(
    error: string,
    server?: VlessConfig,
    options: RecordErrorOptions = {},
  ): boolean {
    const targetServer = server || this.status.currentServer;
    const isBlocking = options.forceBlocking || this.isBlockingError(error);

    logger.error('ConnectionMonitorService', 'Connection error detected', {
      error,
      server: targetServer?.name,
      serverAddress: targetServer?.address,
    });

    this.status.lastError = error;
    this.status.connectionAttempts++;
    this.status.lastHealthState = isBlocking ? 'failed' : 'degraded';
    this.status.lastHealthFailureReason = error;

    if (!targetServer) {
      return false;
    }

    this.emit('error', {
      type: 'error',
      server: targetServer,
      error,
      message: `Connection error: ${error}`,
    } as ConnectionEvent);

    if (!isBlocking) {
      return false;
    }

    this.markServerAsBlocked(targetServer.uuid);
    // Probe fact. Session (ConnectionManager) decides whether this kills
    // the current connection — do not gate on monitor.isConnected.
    this.emit('health-failure', {
      server: targetServer,
      reason: error,
      blocking: true,
    } satisfies HealthFailureEvent);
    return true;
  }

  public markServerAsBlocked(serverId: string): void {
    this.autoSwitchFailedAt.set(serverId, Date.now());
    if (!this.status.blockedServers.has(serverId)) {
      this.status.blockedServers.add(serverId);
      logger.warn('ConnectionMonitorService', 'Server marked as blocked', {
        serverId,
        cooldownMs: ConnectionMonitorService.BLOCKED_SERVER_COOLDOWN_MS,
      });

      const server = this.status.currentServer;
      if (server && server.uuid === serverId) {
        this.emit('blocked', {
          type: 'blocked',
          server,
          message: `Server ${server.name} appears to be blocked`,
        } as ConnectionEvent);
      }
    }
  }

  public pruneExpiredBlockedServers(now: number = Date.now()): void {
    const cooldown = ConnectionMonitorService.BLOCKED_SERVER_COOLDOWN_MS;
    for (const serverId of [...this.status.blockedServers]) {
      const failedAt = this.autoSwitchFailedAt.get(serverId);
      if (failedAt == null || now - failedAt >= cooldown) {
        this.status.blockedServers.delete(serverId);
        this.autoSwitchFailedAt.delete(serverId);
      }
    }
  }

  public triggerImmediateHealthCheck(reason: string): void {
    if (!this.status.isConnected || !this.status.currentServer) {
      return;
    }
    const signal = this.sessionAbort?.signal;
    if (!signal || signal.aborted) {
      return;
    }
    logger.info('ConnectionMonitorService', 'Forcing immediate health check', {
      reason,
      deferred: this.healthCheckGate.isInFlight,
    });
    this.healthCheckGate.request(() => this.checkConnectionHealth(signal));
  }

  /**
   * Probe/diagnostic fact. Does not emit health-failure — ConnectionManager
   * owns policy for session death.
   */
  public noteFailure(
    error: string,
    options: { localProxyReachable?: boolean | null } = {},
  ): void {
    if ('localProxyReachable' in options) {
      this.status.localProxyReachable = options.localProxyReachable ?? null;
    }
    this.status.lastError = error;
    this.status.lastHealthState = 'failed';
    this.status.lastHealthFailureReason = error;
    this.status.lastHealthCheckAt = Date.now();
    if (this.status.currentServer) {
      this.emit('error', {
        type: 'error',
        server: this.status.currentServer,
        error,
        message: `Connection error: ${error}`,
      } as ConnectionEvent);
    }
  }

  private replaceSession(): void {
    this.healthCheckGate.reset();
    this.sessionAbort?.abort();
    this.sessionAbort = new AbortController();
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this.initialHealthCheckTimer) {
      clearTimeout(this.initialHealthCheckTimer);
      this.initialHealthCheckTimer = null;
    }
  }

  private isBlockingError(error: string): boolean {
    return isBlockingErrorText(error);
  }

  private startPeriodicCheck(signal: AbortSignal): void {
    const runCheck = () => {
      this.healthCheckGate.request(() => this.checkConnectionHealth(signal));
    };

    this.initialHealthCheckTimer = setTimeout(() => {
      this.initialHealthCheckTimer = null;
      if (signal.aborted || !this.status.isConnected) {
        return;
      }
      runCheck();
      if (signal.aborted || !this.status.isConnected) {
        return;
      }
      this.checkInterval = setInterval(runCheck, this.checkIntervalMs);
    }, CONNECTION_MONITOR_TIMING.healthCheckInitialDelayMs);
  }

  private async checkConnectionHealth(signal: AbortSignal): Promise<void> {
    if (!this.status.isConnected || !this.status.currentServer) {
      return;
    }
    if (signal.aborted) {
      return;
    }

    const isStale = () =>
      signal.aborted || !this.status.isConnected || !this.status.currentServer;

    try {
      this.status.lastHealthCheckAt = Date.now();
      const probeResult = await runConnectionHealthProbe({
        getXrayHealthStatus: () => xrayService.getHealthStatus(),
        connectionMode: configService.getConnectionMode(),
        ports: xrayService.getActivePorts(),
        tunnelProbe: {
          timeoutMs: CONNECTION_MONITOR_TIMING.healthTunnelProbeTimeoutMs,
          attempts: CONNECTION_MONITOR_TIMING.healthTunnelProbeAttempts,
          gapMs: CONNECTION_MONITOR_TIMING.healthTunnelProbeGapMs,
        },
      });
      if (isStale()) {
        return;
      }
      this.status.localProxyReachable = probeResult.localProxyReachable;

      if (probeResult.type === 'xray-failed') {
        logger.warn('ConnectionMonitorService', 'Xray health reported failed', {
          failureReason: probeResult.failureReason,
        });
        this.handleCriticalConnectionFailure(probeResult.failureReason, {
          localProxyReachable: probeResult.localProxyReachable,
        });
        return;
      }

      if (probeResult.type === 'local-proxy-failed') {
        this.tunnelProbeFailStreak = 0;
        this.localProxyFailStreak += 1;
        const { failureReason, xrayState } = probeResult;

        this.status.lastHealthState =
          xrayState.state === 'failed' ? 'failed' : 'degraded';
        this.status.lastHealthFailureReason = failureReason;

        logger.warn('ConnectionMonitorService', 'Local proxy probe failed', {
          streak: this.localProxyFailStreak,
          failureReason,
          xrayState: xrayState.state,
        });

        const shouldForce =
          xrayState.state === 'failed' ||
          this.localProxyFailStreak >=
            ConnectionMonitorService.LOCAL_PROXY_STREAK_BEFORE_NOTIFY;

        if (shouldForce) {
          this.handleCriticalConnectionFailure(failureReason, {
            localProxyReachable: false,
          });
        }
        return;
      }

      this.localProxyFailStreak = 0;
      if (probeResult.type === 'host-offline') {
        this.tunnelProbeFailStreak = 0;
        this.status.lastHealthState = 'degraded';
        this.status.lastHealthFailureReason = probeResult.failureReason;
        this.status.lastError = null;
        logger.warn(
          'ConnectionMonitorService',
          'Host internet connectivity unavailable; auto-switch deferred',
        );
        return;
      }

      if (probeResult.type === 'tunnel-failed') {
        const { failureReason } = probeResult;
        this.tunnelProbeFailStreak += 1;
        this.status.lastHealthState = 'degraded';
        this.status.lastHealthFailureReason = failureReason;
        logger.warn('ConnectionMonitorService', 'HTTP tunnel probe failed', {
          streak: this.tunnelProbeFailStreak,
        });
        if (
          this.tunnelProbeFailStreak ===
          ConnectionMonitorService.TUNNEL_PROBE_STREAK_BEFORE_NOTIFY
        ) {
          this.recordError(failureReason, this.status.currentServer);
        }
        return;
      }

      this.tunnelProbeFailStreak = 0;
      if (this.status.lastHealthState === 'degraded') {
        this.status.lastError = null;
      }
      logger.debug('ConnectionMonitorService', 'HTTP tunnel probe passed');

      const logLines = await this.readNewLogLines(50);
      if (isStale()) {
        return;
      }
      const errors = this.analyzeLogForErrors(logLines);

      if (errors.length > 0) {
        this.status.lastHealthState = 'degraded';
        this.status.lastHealthFailureReason = errors[0];
        logger.warn('ConnectionMonitorService', 'Health check found errors', {
          errorCount: errors.length,
          errors: errors.slice(0, 3),
        });

        const criticalErrors = errors.filter((e) => this.isBlockingError(e));
        if (criticalErrors.length > 0) {
          this.recordError(criticalErrors[0], this.status.currentServer);
        }
      } else {
        this.status.lastHealthState = 'healthy';
        this.status.lastHealthFailureReason = null;
        logger.debug('ConnectionMonitorService', 'Health check passed');
      }
    } catch (error) {
      if (isStale()) {
        return;
      }
      const failureReason =
        error instanceof Error ? error.message : String(error);
      this.status.lastHealthState = 'failed';
      this.status.lastHealthFailureReason = failureReason;
      logger.error('ConnectionMonitorService', 'Health check failed', error);
      this.tunnelProbeFailStreak += 1;
      if (
        this.tunnelProbeFailStreak ===
        ConnectionMonitorService.TUNNEL_PROBE_STREAK_BEFORE_NOTIFY
      ) {
        this.recordError(failureReason, this.status.currentServer);
      }
    }
  }

  private async readNewLogLines(count: number): Promise<string[]> {
    return this.xrayLogCursor.readNewLines(count);
  }

  private resetLogCursorToFileEnd(): void {
    this.xrayLogCursor.resetToFileEnd();
  }

  private analyzeLogForErrors(logLines: string[]): string[] {
    return extractBlockingErrors(logLines);
  }

  public getStatus(): ConnectionStatus {
    return {
      ...this.status,
      blockedServers: Array.from(this.status.blockedServers),
    };
  }

  public getAutoSwitchingEnabled(): boolean {
    return this.isAutoSwitchingEnabled;
  }

  public setAutoSwitchingEnabled(enabled: boolean): void {
    this.isAutoSwitchingEnabled = enabled;
    logger.info('ConnectionMonitorService', 'Auto-switching', { enabled });
  }

  public clearBlockedServers(): void {
    this.status.blockedServers.clear();
    this.autoSwitchFailedAt.clear();
    logger.info('ConnectionMonitorService', 'Cleared blocked servers list');
  }
}

export const connectionMonitorService = new ConnectionMonitorService();
