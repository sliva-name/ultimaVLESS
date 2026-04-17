import { VlessConfig } from '@/shared/types';
import { logger } from './LoggerService';
import { configService } from './ConfigService';
import { connectionStackService } from './ConnectionStackService';
import { APP_CONSTANTS } from '@/shared/constants';
import { EventEmitter } from 'events';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { extractBlockingErrors, isBlockingErrorText } from './blockingErrors';
import { probeTcpPort, probeHttpThroughProxy } from './networkProbe';
import { xrayService } from './XrayService';
import { ConnectionHealthState } from '@/shared/ipc';

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
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isAutoSwitchingEnabled: boolean = true;
  private checkIntervalMs: number = 30000; // Проверка каждые 30 секунд
  private xrayLogPath: string;
  private monitoringGeneration: number = 0;
  private switchInProgress: boolean = false;
  private logReadOffset: number = 0;
  private logPartialLine = '';
  private healthCheckInFlight: boolean = false;
  /** Consecutive HTTP tunnel probe failures (flaky checks should not spam Last Error). */
  private tunnelProbeFailStreak: number = 0;

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
    this.xrayLogPath = path.join(userDataPath, 'xray.log');
    
    logger.info('ConnectionMonitorService', 'Initialized');
  }

  /**
   * Starts monitoring the current connection.
   */
  public startMonitoring(server: VlessConfig): void {
    logger.info('ConnectionMonitorService', 'Starting monitoring', { 
      serverName: server.name,
      serverAddress: server.address 
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
    this.resetLogCursorToFileEnd();

    // Начинаем периодическую проверку соединения
    this.startPeriodicCheck();

    this.emit('connected', { 
      type: 'connected', 
      server,
      message: `Connected to ${server.name}` 
    } as ConnectionEvent);
  }

  /**
   * Stops monitoring.
   */
  public stopMonitoring(options: { message?: string; preserveLastError?: boolean } = {}): void {
    const { message = 'Monitoring stopped', preserveLastError = false } = options;
    this.monitoringGeneration += 1;
    this.switchInProgress = false;
    logger.info('ConnectionMonitorService', 'Stopping monitoring');
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.status.isConnected = false;
    this.status.currentServer = null;
    this.status.localProxyReachable = null;
    this.tunnelProbeFailStreak = 0;
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

    const currentProtocol = currentServer.protocol ?? 'vless';
    const fuzzy = servers.find((server) => {
      if (server.address !== currentServer.address || server.port !== currentServer.port) {
        return false;
      }
      return (server.protocol ?? 'vless') === currentProtocol;
    });

    if (fuzzy) {
      logger.info('ConnectionMonitorService', 'Tracked server matched by address/port after uuid rotation', {
        from: currentServer.uuid.substring(0, 12),
        to: fuzzy.uuid.substring(0, 12),
        address: currentServer.address,
        port: currentServer.port,
      });
      this.status.currentServer = fuzzy;
      return fuzzy;
    }

    return currentServer;
  }

  /**
   * Records a connection error.
   */
  public recordError(error: string, server?: VlessConfig): void {
    const targetServer = server || this.status.currentServer;
    
    logger.error('ConnectionMonitorService', 'Connection error detected', {
      error,
      server: targetServer?.name,
      serverAddress: targetServer?.address,
    });

    this.status.lastError = error;
    this.status.connectionAttempts++;
    this.status.lastHealthState = this.isBlockingError(error) ? 'failed' : 'degraded';
    this.status.lastHealthFailureReason = error;

    if (targetServer) {
      this.emit('error', {
        type: 'error',
        server: targetServer,
        error,
        message: `Connection error: ${error}`,
      } as ConnectionEvent);

      // Если ошибка указывает на блокировку, помечаем сервер
      if (this.isBlockingError(error)) {
        this.markServerAsBlocked(targetServer.uuid);
        
        if (this.isAutoSwitchingEnabled && this.status.isConnected) {
          this.scheduleAutoSwitch();
        }
      }
    }
  }

  /**
   * Checks if an error indicates a blocking issue.
   */
  private isBlockingError(error: string): boolean {
    return isBlockingErrorText(error);
  }

  /**
   * Marks a server as blocked.
   */
  private markServerAsBlocked(serverId: string): void {
    if (!this.status.blockedServers.has(serverId)) {
      this.status.blockedServers.add(serverId);
      logger.warn('ConnectionMonitorService', 'Server marked as blocked', { serverId });
      
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
   * Starts periodic connection health checks.
   */
  private startPeriodicCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(() => {
      void this.checkConnectionHealth();
    }, this.checkIntervalMs);
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
      this.monitoringGeneration !== generationAtStart || !this.status.isConnected || !this.status.currentServer;

    this.healthCheckInFlight = true;
    try {
      this.status.lastHealthCheckAt = Date.now();
      const [socksReady, httpReady] = await Promise.all([
        probeTcpPort(APP_CONSTANTS.PORTS.SOCKS),
        probeTcpPort(APP_CONSTANTS.PORTS.HTTP),
      ]);
      if (isStale()) {
        return;
      }
      const localProxyReachable = socksReady && httpReady;
      this.status.localProxyReachable = localProxyReachable;

      if (!localProxyReachable) {
        this.tunnelProbeFailStreak = 0;
        const xrayState = xrayService.getHealthStatus();
        const failureReason = xrayState.lastReadinessError || 'Local proxy listeners are unreachable';
        
        const previousState = this.status.lastHealthState;
        const previousReason = this.status.lastHealthFailureReason;

        this.status.lastHealthState = xrayState.state === 'failed' ? 'failed' : 'degraded';
        this.status.lastHealthFailureReason = failureReason;

        if (previousReason !== failureReason || previousState !== this.status.lastHealthState) {
          this.recordError(failureReason, this.status.currentServer);
        } else {
          logger.debug('ConnectionMonitorService', 'Local proxy listeners still unreachable', { failureReason });
        }
        return;
      }

      // Verify end-to-end connectivity through the tunnel via a lightweight HTTP probe.
      const tunnelOk = await probeHttpThroughProxy(APP_CONSTANTS.PORTS.HTTP);
      if (isStale()) {
        return;
      }
      if (!tunnelOk) {
        const failureReason =
          'Remote endpoint check via proxy failed after retries (tunnel may be slow or blocked)';
        this.tunnelProbeFailStreak += 1;
        this.status.lastHealthState = 'degraded';
        this.status.lastHealthFailureReason = failureReason;
        logger.warn('ConnectionMonitorService', 'HTTP tunnel probe failed', {
          streak: this.tunnelProbeFailStreak,
        });
        // Surface error exactly once when reaching the streak threshold
        if (this.tunnelProbeFailStreak === 2) {
          this.recordError(failureReason, this.status.currentServer);
        }
        return;
      }

      this.tunnelProbeFailStreak = 0;
      logger.debug('ConnectionMonitorService', 'HTTP tunnel probe passed');

      // Читаем только новые строки со времени старта текущей сессии.
      const logLines = this.readNewLogLines(50);
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
      this.status.lastHealthFailureReason = error instanceof Error ? error.message : String(error);
      logger.error('ConnectionMonitorService', 'Health check failed', error);
    } finally {
      this.healthCheckInFlight = false;
    }
  }

  /**
   * Reads recent lines from Xray log file.
   */
  private readNewLogLines(count: number): string[] {
    try {
      if (!fs.existsSync(this.xrayLogPath)) {
        return [];
      }

      const stats = fs.statSync(this.xrayLogPath);
      if (stats.size === 0) {
        return [];
      }

      const maxChunkBytes = 128 * 1024;
      if (stats.size < this.logReadOffset) {
        this.logReadOffset = 0;
        this.logPartialLine = '';
      }

      const previousOffset = this.logReadOffset;
      const unreadLength = stats.size - previousOffset;
      if (unreadLength <= 0) {
        return [];
      }

      const readStart = unreadLength > maxChunkBytes
        ? stats.size - maxChunkBytes
        : previousOffset;
      const readLength = stats.size - readStart;
      const buffer = Buffer.alloc(readLength);
      const fd = fs.openSync(this.xrayLogPath, 'r');
      try {
        fs.readSync(fd, buffer, 0, readLength, readStart);
      } finally {
        fs.closeSync(fd);
      }

      const content = buffer.toString('utf-8');
      const combined = `${readStart === previousOffset ? this.logPartialLine : ''}${content}`;
      this.logReadOffset = stats.size;
      const chunks = combined.split('\n');
      this.logPartialLine = chunks.pop() ?? '';
      const lines = chunks
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      return lines.slice(-count);
    } catch (error) {
      logger.error('ConnectionMonitorService', 'Failed to read log file', error);
      return [];
    }
  }

  private resetLogCursorToFileEnd(): void {
    try {
      if (!fs.existsSync(this.xrayLogPath)) {
        this.logReadOffset = 0;
        this.logPartialLine = '';
        return;
      }
      const stats = fs.statSync(this.xrayLogPath);
      this.logReadOffset = stats.size;
      this.logPartialLine = '';
    } catch (error) {
      logger.warn('ConnectionMonitorService', 'Failed to reset log cursor', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.logReadOffset = 0;
      this.logPartialLine = '';
    }
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
  private scheduleAutoSwitch(): void {
    if (this.reconnectTimeout) {
      return; // Уже запланировано переключение
    }

    logger.info('ConnectionMonitorService', 'Scheduling auto-switch');
    const scheduledGeneration = this.monitoringGeneration;

    // Переключаемся через 5 секунд после обнаружения проблемы
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      // Bail out when the monitoring session changed (stop/new connection) —
      // otherwise we would switch a session we no longer own.
      if (this.monitoringGeneration !== scheduledGeneration) {
        logger.debug('ConnectionMonitorService', 'Auto-switch skipped (stale generation)', {
          scheduled: scheduledGeneration,
          current: this.monitoringGeneration,
        });
        return;
      }
      if (!this.status.isConnected || !this.status.currentServer) {
        logger.debug('ConnectionMonitorService', 'Auto-switch skipped (not connected)');
        return;
      }
      void this.attemptAutoSwitch();
    }, 5000);
  }

  /**
   * Attempts to automatically switch to another server.
   */
  private async attemptAutoSwitch(): Promise<void> {
    if (!this.status.currentServer || this.switchInProgress) {
      return;
    }
    const generationAtStart = this.monitoringGeneration;

    logger.info('ConnectionMonitorService', 'Attempting auto-switch');

    const servers = configService.getServers();
    if (servers.length === 0) {
      logger.warn('ConnectionMonitorService', 'No servers available for switching');
      return;
    }

    // Находим следующий доступный сервер
    const currentIndex = servers.findIndex(s => s.uuid === this.status.currentServer!.uuid);
    const availableServers = servers.filter(s => !this.status.blockedServers.has(s.uuid));

    if (availableServers.length === 0) {
      logger.warn('ConnectionMonitorService', 'All servers appear to be blocked');
      this.status.blockedServers.clear(); // Сбрасываем список блокировок
      return;
    }

    // Выбираем следующий сервер (циклически)
    let nextServer: VlessConfig | null = null;
    
    if (currentIndex >= 0) {
      // Ищем следующий сервер после текущего
      for (let i = 1; i < servers.length; i++) {
        const candidate = servers[(currentIndex + i) % servers.length];
        if (!this.status.blockedServers.has(candidate.uuid)) {
          nextServer = candidate;
          break;
        }
      }
    }

    if (!nextServer) {
      // Если не нашли, берем первый доступный
      nextServer = availableServers[0];
    }

    if (nextServer && this.status.currentServer && nextServer.uuid === this.status.currentServer.uuid) {
      logger.warn('ConnectionMonitorService', 'Auto-switch skipped because next server equals current server', {
        server: nextServer.name,
      });
      return;
    }

    if (nextServer) {
      logger.info('ConnectionMonitorService', 'Switching to server', {
        from: this.status.currentServer.name,
        to: nextServer.name,
      });

      this.emit('switch-operation-started');
      this.emit('switching', {
        type: 'switching',
        server: nextServer,
        message: `Switching from ${this.status.currentServer.name} to ${nextServer.name}`,
      } as ConnectionEvent);

      // Переключаемся на новый сервер
      this.switchInProgress = true;
      try {
        await this.switchToServer(nextServer, generationAtStart);
      } finally {
        this.switchInProgress = false;
        this.emit('switch-operation-finished');
      }
    }
  }

  /**
   * Switches to a different server.
   */
  private async switchToServer(server: VlessConfig, expectedGeneration: number): Promise<void> {
    try {
      if (this.monitoringGeneration !== expectedGeneration || !this.status.isConnected) return;
      const connectionMode = configService.getConnectionMode();

      configService.setSelectedServerId(server.uuid);

      await connectionStackService.transitionTo(server, connectionMode, {
        http: APP_CONSTANTS.PORTS.HTTP,
        socks: APP_CONSTANTS.PORTS.SOCKS,
      }, {
        stopXray: true,
        delayBeforeApplyMs: 1000,
      });
      if (this.monitoringGeneration !== expectedGeneration || !this.status.isConnected) {
        await connectionStackService.resetNetworkingStack({ stopXray: true });
        return;
      }
      
      // Обновляем статус мониторинга
      this.startMonitoring(server);

      logger.info('ConnectionMonitorService', 'Successfully switched server', {
        serverName: server.name,
        connectionMode,
      });
    } catch (error) {
      logger.error('ConnectionMonitorService', 'Failed to switch server', error);
      const errorMessage = `Failed to switch: ${error instanceof Error ? error.message : String(error)}`;
      this.recordError(errorMessage, server);
      
      // Если переключение не удалось, пытаемся отключиться
      try {
        await connectionStackService.cleanupAfterFailure();
        this.stopMonitoring();
      } catch (cleanupError) {
        logger.error('ConnectionMonitorService', 'Cleanup after switch failure failed', cleanupError);
      }
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
    logger.info('ConnectionMonitorService', 'Cleared blocked servers list');
  }
}

export const connectionMonitorService = new ConnectionMonitorService();
