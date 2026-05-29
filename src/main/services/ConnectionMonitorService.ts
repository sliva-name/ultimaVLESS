import { ConnectionMode, VlessConfig } from '@/shared/types';
import { isSameServerIdentity } from '@/shared/serverIdentity';
import { logger } from './LoggerService';
import { configService } from './ConfigService';
import { APP_CONSTANTS } from '@/shared/constants';
import { EventEmitter } from 'events';
import { app } from 'electron';
import path from 'path';
import { extractBlockingErrors, isBlockingErrorText } from './blockingErrors';
import { xrayService } from './XrayService';
import { ConnectionHealthState, XrayHealthStatus } from '@/shared/ipc';
import { runConnectionHealthProbe } from './connectionMonitor/healthProbe';
import { XrayLogCursor } from './connectionMonitor/xrayLogCursor';
import { selectAutoSwitchCandidates } from './connectionMonitor/autoSwitchPolicy';
import { CONNECTION_MONITOR_TIMING } from './connectionMonitor/timing';
import { probeHttpThroughProxy, probeTcpPort } from './networkProbe';

export interface ConnectionStatus {
  isConnected: boolean;
  currentServer: VlessConfig | null;
  lastError: string | null;
  connectionAttempts: number;
  lastConnectionTime: number | null;
  blockedServers: string[]; // UUID серверов, которые были заблокированы (массив для сериализации)
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
  blockedServers: Set<string>; // Внутреннее использование Set для эффективности
  lastHealthCheckAt: number | null;
  lastHealthState: ConnectionHealthState;
  lastHealthFailureReason: string | null;
  localProxyReachable: boolean | null;
}

interface RecordErrorOptions {
  forceBlocking?: boolean;
}

type SwitchAttemptResult = 'switched' | 'failed' | 'stale';
type SwitchExecutor = (server: VlessConfig) => Promise<void>;
type CleanupExecutor = () => Promise<void>;

export interface ConnectionEvent {
  type: 'connected' | 'disconnected' | 'error' | 'blocked' | 'switching';
  server: VlessConfig | null;
  error?: string;
  message?: string;
}

/**
 * Service for monitoring connection status and automatically switching servers
 * when connection issues or blocks are detected.
 */
export class ConnectionMonitorService extends EventEmitter {
  private status: InternalConnectionStatus;
  private checkInterval: NodeJS.Timeout | null = null;
  private initialHealthCheckTimer: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isAutoSwitchingEnabled: boolean = true;
  private checkIntervalMs: number =
    CONNECTION_MONITOR_TIMING.healthCheckIntervalMs;
  private xrayLogCursor: XrayLogCursor;
  private monitoringGeneration: number = 0;
  private switchInProgress: boolean = false;
  private healthCheckInFlight: boolean = false;
  /** Consecutive HTTP tunnel probe failures (flaky checks should not spam Last Error). */
  private tunnelProbeFailStreak: number = 0;
  /** Consecutive local listener probe failures; single misses can happen under Windows socket pressure. */
  private localProxyFailStreak: number = 0;
  private autoSwitchFailedAt: Map<string, number> = new Map();
  private static readonly TUNNEL_PROBE_STREAK_BEFORE_NOTIFY =
    CONNECTION_MONITOR_TIMING.tunnelProbeStreakBeforeAction;
  private static readonly LOCAL_PROXY_STREAK_BEFORE_NOTIFY =
    CONNECTION_MONITOR_TIMING.localProxyStreakBeforeNotify;
  private static readonly AUTO_SWITCH_DELAY_MS =
    CONNECTION_MONITOR_TIMING.autoSwitchDelayMs;
  private static readonly AUTO_SWITCH_CANDIDATE_LIMIT = 30;
  private static readonly AUTO_SWITCH_VALIDATION_TIMEOUT_MS = 2000;
  private static readonly AUTO_SWITCH_VALIDATION_ATTEMPTS = 1;
  private switchExecutor: SwitchExecutor = async () => {
    throw new Error('Auto-switch executor is not configured');
  };
  private cleanupExecutor: CleanupExecutor = async () => {
    throw new Error('Connection cleanup executor is not configured');
  };

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

  public setSwitchExecutor(executor: SwitchExecutor): void {
    this.switchExecutor = executor;
  }

  public setCleanupExecutor(executor: CleanupExecutor): void {
    this.cleanupExecutor = executor;
  }

  private cleanupRuntimeAfterFailure(): Promise<void> {
    return this.cleanupExecutor();
  }

  /**
   * Starts monitoring the current connection.
   */
  public startMonitoring(server: VlessConfig): void {
    logger.info('ConnectionMonitorService', 'Starting monitoring', {
      serverName: server.name,
      serverAddress: server.address,
    });

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.monitoringGeneration += 1;
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

    // Начинаем периодическую проверку соединения
    this.startPeriodicCheck();

    this.emit('connected', {
      type: 'connected',
      server,
      message: `Connected to ${server.name}`,
    } as ConnectionEvent);
  }

  /**
   * Stops monitoring.
   */
  public stopMonitoring(
    options: { message?: string; preserveLastError?: boolean } = {},
  ): void {
    const { message = 'Monitoring stopped', preserveLastError = false } =
      options;
    this.monitoringGeneration += 1;
    this.switchInProgress = false;
    logger.info('ConnectionMonitorService', 'Stopping monitoring');

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    if (this.initialHealthCheckTimer) {
      clearTimeout(this.initialHealthCheckTimer);
      this.initialHealthCheckTimer = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

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

  public handleXrayHealthStatusChanged(xrayState: XrayHealthStatus): boolean {
    if (xrayState.state !== 'failed') {
      return false;
    }

    return this.handleCriticalConnectionFailure(
      this.getXrayFailureReason(xrayState),
      {
        localProxyReachable: xrayState.localProxyReachable,
      },
    );
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

  /**
   * Returns the up-to-date reference of the currently tracked server after a
   * server list refresh, or `null` if monitoring isn't tracking anything.
   * When the tracked server is no longer present in the list we keep the
   * original reference (so callers can react) but leave internal state alone.
   *
   * The match is tolerant to `uuid` rotation: providers that rotate VLESS
   * credentials (or Trojan passwords) produce a new stable-id hash for the
   * same endpoint between fetches, so we fall back to matching on
   * protocol + address + port when uuids don't line up. Without this the
   * refreshed list ends up with a ghost copy of the active server next to
   * its rotated twin.
   */
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

    return currentServer;
  }

  /**
   * Records a connection error.
   */
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

    if (targetServer) {
      this.emit('error', {
        type: 'error',
        server: targetServer,
        error,
        message: `Connection error: ${error}`,
      } as ConnectionEvent);

      // Если ошибка указывает на блокировку, помечаем сервер
      if (isBlocking) {
        this.markServerAsBlocked(targetServer.uuid);

        if (this.isAutoSwitchingEnabled && this.status.isConnected) {
          return this.scheduleAutoSwitch();
        }
      }
    }

    return false;
  }

  /**
   * Checks if an error indicates a blocking issue.
   */
  private isBlockingError(error: string): boolean {
    return isBlockingErrorText(error);
  }

  private getXrayFailureReason(xrayState: XrayHealthStatus): string {
    return (
      xrayState.lastFailureReason ||
      xrayState.lastReadinessError ||
      'Xray reported failed health status'
    );
  }

  /**
   * Marks a server as blocked.
   */
  private markServerAsBlocked(serverId: string): void {
    this.autoSwitchFailedAt.set(serverId, Date.now());
    if (!this.status.blockedServers.has(serverId)) {
      this.status.blockedServers.add(serverId);
      logger.warn('ConnectionMonitorService', 'Server marked as blocked', {
        serverId,
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

  /**
   * Forces an immediate health probe outside the periodic schedule. Used after
   * the OS resumes from sleep, where the tunnel/socket state is frequently
   * broken but the next scheduled tick may be up to `checkIntervalMs` away.
   * Reuses the normal probe path so a dead tunnel triggers the existing
   * auto-switch / recovery machinery.
   */
  public triggerImmediateHealthCheck(reason: string): void {
    if (!this.status.isConnected || !this.status.currentServer) {
      return;
    }
    logger.info('ConnectionMonitorService', 'Forcing immediate health check', {
      reason,
    });
    void this.checkConnectionHealth();
  }

  /**
   * Starts periodic connection health checks.
   */
  private startPeriodicCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    if (this.initialHealthCheckTimer) {
      clearTimeout(this.initialHealthCheckTimer);
      this.initialHealthCheckTimer = null;
    }

    const runCheck = () => {
      void this.checkConnectionHealth();
    };

    // First tick after a short warmup; only then start the 15s interval so we
    // do not get two probes within a few seconds (interval at 15s + initial at 5s).
    this.initialHealthCheckTimer = setTimeout(() => {
      runCheck();
      this.checkInterval = setInterval(runCheck, this.checkIntervalMs);
    }, CONNECTION_MONITOR_TIMING.healthCheckInitialDelayMs);
  }

  /**
   * Checks the health of the current connection by analyzing Xray logs.
   */
  private async checkConnectionHealth(): Promise<void> {
    if (!this.status.isConnected || !this.status.currentServer) {
      return;
    }
    if (this.healthCheckInFlight) {
      return;
    }

    const generationAtStart = this.monitoringGeneration;
    const isStale = () =>
      this.monitoringGeneration !== generationAtStart ||
      !this.status.isConnected ||
      !this.status.currentServer;

    this.healthCheckInFlight = true;
    try {
      this.status.lastHealthCheckAt = Date.now();
      const probeResult = await runConnectionHealthProbe({
        getXrayHealthStatus: () => xrayService.getHealthStatus(),
        connectionMode: configService.getConnectionMode(),
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
        const forceBlocking = xrayState.state === 'failed';

        this.status.lastHealthState =
          xrayState.state === 'failed' ? 'failed' : 'degraded';
        this.status.lastHealthFailureReason = failureReason;

        logger.warn('ConnectionMonitorService', 'Local proxy probe failed', {
          streak: this.localProxyFailStreak,
          failureReason,
        });

        const shouldSurface =
          xrayState.state === 'failed' ||
          this.localProxyFailStreak >=
            ConnectionMonitorService.LOCAL_PROXY_STREAK_BEFORE_NOTIFY;

        if (shouldSurface && this.status.lastError !== failureReason) {
          this.recordError(failureReason, this.status.currentServer, {
            forceBlocking,
          });
        } else {
          logger.debug(
            'ConnectionMonitorService',
            'Local proxy listeners still unreachable or below notify threshold',
            { failureReason, streak: this.localProxyFailStreak },
          );
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
        // Surface error once when reaching the streak threshold (see class JSDoc).
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

      // Читаем только новые строки со времени старта текущей сессии.
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
          errors: errors.slice(0, 3), // Логируем первые 3 ошибки
        });

        // Если найдены критические ошибки, записываем их
        const criticalErrors = errors.filter((e) => this.isBlockingError(e));
        if (criticalErrors.length > 0) {
          this.recordError(criticalErrors[0], this.status.currentServer);
        }
      } else {
        // Соединение выглядит здоровым
        this.status.lastHealthState = 'healthy';
        this.status.lastHealthFailureReason = null;
        logger.debug('ConnectionMonitorService', 'Health check passed');
      }
    } catch (error) {
      if (isStale()) {
        return;
      }
      this.status.lastHealthState = 'failed';
      this.status.lastHealthFailureReason =
        error instanceof Error ? error.message : String(error);
      logger.error('ConnectionMonitorService', 'Health check failed', error);
    } finally {
      this.healthCheckInFlight = false;
    }
  }

  /**
   * Reads recent lines from Xray log file.
   */
  private async readNewLogLines(count: number): Promise<string[]> {
    return this.xrayLogCursor.readNewLines(count);
  }

  /**
   * Synchronous on purpose: must complete before {@link startPeriodicCheck}
   * fires its first tick AND before any caller appends to xray.log so the
   * cursor lands at the true end-of-file. Called once per `startMonitoring`,
   * not periodically — the periodic health-check uses async `fs.promises.*`.
   */
  private resetLogCursorToFileEnd(): void {
    this.xrayLogCursor.resetToFileEnd();
  }

  /**
   * Analyzes log lines for connection errors.
   */
  private analyzeLogForErrors(logLines: string[]): string[] {
    return extractBlockingErrors(logLines);
  }

  /**
   * Schedules automatic server switching.
   */
  private scheduleAutoSwitch(): boolean {
    if (!this.status.isConnected || !this.status.currentServer) {
      return false;
    }
    if (this.reconnectTimeout) {
      return true; // Уже запланировано переключение
    }
    if (this.switchInProgress) {
      return true;
    }

    logger.info('ConnectionMonitorService', 'Scheduling auto-switch');
    const scheduledGeneration = this.monitoringGeneration;

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      // Bail out when the monitoring session changed (stop/new connection) —
      // otherwise we would switch a session we no longer own.
      if (this.monitoringGeneration !== scheduledGeneration) {
        logger.debug(
          'ConnectionMonitorService',
          'Auto-switch skipped (stale generation)',
          {
            scheduled: scheduledGeneration,
            current: this.monitoringGeneration,
          },
        );
        return;
      }
      if (!this.status.isConnected || !this.status.currentServer) {
        logger.debug(
          'ConnectionMonitorService',
          'Auto-switch skipped (not connected)',
        );
        return;
      }
      void this.attemptAutoSwitch();
    }, ConnectionMonitorService.AUTO_SWITCH_DELAY_MS);
    return true;
  }

  /**
   * Attempts to automatically switch to another server.
   */
  private async attemptAutoSwitch(): Promise<void> {
    if (!this.status.currentServer || this.switchInProgress) {
      return;
    }
    const generationAtStart = this.monitoringGeneration;
    const fromServer = this.status.currentServer;

    logger.info('ConnectionMonitorService', 'Attempting auto-switch');

    const servers = configService.getServers();
    const selection = selectAutoSwitchCandidates(
      servers,
      fromServer,
      this.status.blockedServers,
      {
        maxCandidates: ConnectionMonitorService.AUTO_SWITCH_CANDIDATE_LIMIT,
      },
    );

    if (selection.type === 'no-servers') {
      logger.warn(
        'ConnectionMonitorService',
        'No servers available for switching',
      );
      return;
    }

    if (selection.type === 'all-blocked') {
      logger.warn(
        'ConnectionMonitorService',
        'All servers appear to be blocked',
      );
      return;
    }

    if (selection.type === 'same-server') {
      logger.warn(
        'ConnectionMonitorService',
        'Auto-switch skipped because next server equals current server',
        {
          server: selection.server.name,
        },
      );
      return;
    }

    const candidates =
      selection.type === 'selected'
        ? [selection.server]
        : selection.candidates;
    logger.info('ConnectionMonitorService', 'Auto-switch candidates selected', {
      from: fromServer.name,
      candidateCount: candidates.length,
      candidates: candidates.slice(0, 5).map((server) => ({
        name: server.name,
        ping: server.ping ?? null,
        pingStale: server.pingStale ?? false,
      })),
    });

    this.emit('switch-operation-started');
    this.switchInProgress = true;
    try {
      for (const candidate of candidates) {
        if (
          this.monitoringGeneration !== generationAtStart ||
          !this.status.isConnected
        ) {
          return;
        }

        this.emit('switching', {
          type: 'switching',
          server: candidate,
          message: `Switching from ${fromServer.name} to ${candidate.name}`,
        } as ConnectionEvent);

        const result = await this.switchToServer(candidate, generationAtStart);
        if (result === 'switched') {
          return;
        }
        if (result === 'stale') {
          return;
        }
      }

      const errorMessage = 'Auto-switch failed: no working servers found';
      this.status.lastError = errorMessage;
      this.status.lastHealthState = 'failed';
      this.status.lastHealthFailureReason = errorMessage;
      logger.error('ConnectionMonitorService', errorMessage, {
        triedCandidates: candidates.length,
        blockedServers: this.status.blockedServers.size,
      });
      await this.cleanupRuntimeAfterFailure();
      this.stopMonitoring({
        message: errorMessage,
        preserveLastError: true,
      });
    } finally {
      this.switchInProgress = false;
      this.emit('switch-operation-finished');
    }
  }

  private recordAutoSwitchCandidateFailure(
    server: VlessConfig,
    reason: string,
  ): void {
    this.markServerAsBlocked(server.uuid);
    this.status.lastError = reason;
    this.status.connectionAttempts += 1;
    this.status.lastHealthState = 'failed';
    this.status.lastHealthFailureReason = reason;
    logger.warn('ConnectionMonitorService', 'Auto-switch candidate failed', {
      server: server.name,
      serverAddress: server.address,
      reason,
      failedAt: this.autoSwitchFailedAt.get(server.uuid) ?? null,
    });
  }

  private async validateSwitchedServerTraffic(
    connectionMode: ConnectionMode,
  ): Promise<boolean> {
    const timeoutMs =
      ConnectionMonitorService.AUTO_SWITCH_VALIDATION_TIMEOUT_MS;
    const [socksReady, httpReady] = await Promise.all([
      probeTcpPort(APP_CONSTANTS.PORTS.SOCKS, '127.0.0.1', timeoutMs),
      probeTcpPort(APP_CONSTANTS.PORTS.HTTP, '127.0.0.1', timeoutMs),
    ]);

    if (!socksReady || !httpReady) {
      logger.warn(
        'ConnectionMonitorService',
        'Post-switch local proxy validation failed',
        { connectionMode, socksReady, httpReady },
      );
      return false;
    }

    const xrayHealth = xrayService.getHealthStatus();
    if (xrayHealth.state === 'failed') {
      logger.warn(
        'ConnectionMonitorService',
        'Post-switch Xray health validation failed',
        {
          connectionMode,
          failureReason:
            xrayHealth.lastFailureReason || xrayHealth.lastReadinessError,
        },
      );
      return false;
    }

    const tunnelOk = await probeHttpThroughProxy(
      APP_CONSTANTS.PORTS.HTTP,
      '127.0.0.1',
      timeoutMs,
      ConnectionMonitorService.AUTO_SWITCH_VALIDATION_ATTEMPTS,
      0,
    );
    if (!tunnelOk) {
      logger.warn(
        'ConnectionMonitorService',
        'Post-switch traffic validation failed',
        { connectionMode },
      );
    }
    return tunnelOk;
  }

  /**
   * Switches to a different server.
   */
  private async switchToServer(
    server: VlessConfig,
    expectedGeneration: number,
  ): Promise<SwitchAttemptResult> {
    try {
      if (
        this.monitoringGeneration !== expectedGeneration ||
        !this.status.isConnected
      )
        return 'stale';
      const connectionMode = configService.getConnectionMode();

      await this.switchExecutor(server);
      if (
        this.monitoringGeneration !== expectedGeneration ||
        !this.status.isConnected
      ) {
        await this.cleanupRuntimeAfterFailure();
        return 'stale';
      }

      if (!(await this.validateSwitchedServerTraffic(connectionMode))) {
        this.recordAutoSwitchCandidateFailure(
          server,
          'Post-switch traffic validation failed',
        );
        await this.cleanupRuntimeAfterFailure();
        return 'failed';
      }

      configService.setSelectedServerId(server.uuid);

      // Обновляем статус мониторинга
      this.startMonitoring(server);

      logger.info('ConnectionMonitorService', 'Successfully switched server', {
        serverName: server.name,
        connectionMode,
      });
      return 'switched';
    } catch (error) {
      logger.error(
        'ConnectionMonitorService',
        'Failed to switch server',
        error,
      );
      const errorMessage = `Failed to switch: ${error instanceof Error ? error.message : String(error)}`;
      this.recordAutoSwitchCandidateFailure(server, errorMessage);

      try {
        await this.cleanupRuntimeAfterFailure();
      } catch (cleanupError) {
        logger.error(
          'ConnectionMonitorService',
          'Cleanup after switch failure failed',
          cleanupError,
        );
      }
      return 'failed';
    }
  }

  /**
   * Gets current connection status.
   */
  public getStatus(): ConnectionStatus {
    return {
      ...this.status,
      blockedServers: Array.from(this.status.blockedServers), // Конвертируем Set в массив
    };
  }

  /**
   * Gets whether auto-switching is enabled.
   */
  public getAutoSwitchingEnabled(): boolean {
    return this.isAutoSwitchingEnabled;
  }

  /**
   * Enables or disables automatic switching.
   */
  public setAutoSwitchingEnabled(enabled: boolean): void {
    this.isAutoSwitchingEnabled = enabled;
    logger.info('ConnectionMonitorService', 'Auto-switching', { enabled });
  }

  /**
   * Clears the blocked servers list.
   */
  public clearBlockedServers(): void {
    this.status.blockedServers.clear();
    this.autoSwitchFailedAt.clear();
    logger.info('ConnectionMonitorService', 'Cleared blocked servers list');
  }
}

export const connectionMonitorService = new ConnectionMonitorService();
