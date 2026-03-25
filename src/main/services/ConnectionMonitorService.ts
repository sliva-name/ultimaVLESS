import { VlessConfig } from '../../shared/types';
import { logger } from './LoggerService';
import { xrayService } from './XrayService';
import { configService } from './ConfigService';
import { systemProxyService } from './SystemProxyService';
import { tunRouteService } from './TunRouteService';
import { APP_CONSTANTS } from '../../shared/constants';
import { EventEmitter } from 'events';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

export interface ConnectionStatus {
  isConnected: boolean;
  currentServer: VlessConfig | null;
  lastError: string | null;
  connectionAttempts: number;
  lastConnectionTime: number | null;
  blockedServers: string[]; // UUID серверов, которые были заблокированы (массив для сериализации)
}

interface InternalConnectionStatus {
  isConnected: boolean;
  currentServer: VlessConfig | null;
  lastError: string | null;
  connectionAttempts: number;
  lastConnectionTime: number | null;
  blockedServers: Set<string>; // Внутреннее использование Set для эффективности
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

  constructor() {
    super();
    this.status = {
      isConnected: false,
      currentServer: null,
      lastError: null,
      connectionAttempts: 0,
      lastConnectionTime: null,
      blockedServers: new Set(),
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

    this.status.currentServer = server;
    this.status.isConnected = true;
    this.status.lastConnectionTime = Date.now();
    this.status.connectionAttempts = 0;
    this.status.lastError = null;

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
  public stopMonitoring(): void {
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

    this.emit('disconnected', { 
      type: 'disconnected', 
      server: null,
      message: 'Monitoring stopped' 
    } as ConnectionEvent);
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
    const blockingIndicators = [
      'connection refused',
      'connection reset',
      'timeout',
      'network unreachable',
      'no route to host',
      'connection closed',
      'handshake failure',
      'certificate',
      'tls',
      'blocked',
      'forbidden',
    ];

    const lowerError = error.toLowerCase();
    return blockingIndicators.some(indicator => lowerError.includes(indicator));
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
      this.checkConnectionHealth();
    }, this.checkIntervalMs);
  }

  /**
   * Checks the health of the current connection by analyzing Xray logs.
   */
  private checkConnectionHealth(): void {
    if (!this.status.isConnected || !this.status.currentServer) {
      return;
    }

    try {
      // Читаем последние строки лога Xray для анализа
      const logLines = this.readRecentLogLines(50);
      const errors = this.analyzeLogForErrors(logLines);

      if (errors.length > 0) {
        logger.warn('ConnectionMonitorService', 'Health check found errors', {
          errorCount: errors.length,
          errors: errors.slice(0, 3), // Логируем первые 3 ошибки
        });

        // Если найдены критические ошибки, записываем их
        const criticalErrors = errors.filter(e => this.isBlockingError(e));
        if (criticalErrors.length > 0 && this.isAutoSwitchingEnabled) {
          this.recordError(criticalErrors[0], this.status.currentServer);
        }
      } else {
        // Соединение выглядит здоровым
        logger.debug('ConnectionMonitorService', 'Health check passed');
      }
    } catch (error) {
      logger.error('ConnectionMonitorService', 'Health check failed', error);
    }
  }

  /**
   * Reads recent lines from Xray log file.
   */
  private readRecentLogLines(count: number): string[] {
    try {
      if (!fs.existsSync(this.xrayLogPath)) {
        return [];
      }

      const stats = fs.statSync(this.xrayLogPath);
      if (stats.size === 0) {
        return [];
      }

      const maxTailBytes = 128 * 1024;
      const readStart = Math.max(0, stats.size - maxTailBytes);
      const readLength = stats.size - readStart;
      const buffer = Buffer.alloc(readLength);
      const fd = fs.openSync(this.xrayLogPath, 'r');
      try {
        fs.readSync(fd, buffer, 0, readLength, readStart);
      } finally {
        fs.closeSync(fd);
      }

      const content = buffer.toString('utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      return lines.slice(-count);
    } catch (error) {
      logger.error('ConnectionMonitorService', 'Failed to read log file', error);
      return [];
    }
  }

  /**
   * Analyzes log lines for connection errors.
   */
  private analyzeLogForErrors(logLines: string[]): string[] {
    const errors: string[] = [];
    const errorPatterns = [
      /failed to dial/i,
      /connection refused/i,
      /timeout/i,
      /network unreachable/i,
      /handshake failure/i,
      /certificate/i,
      /tls/i,
      /error/i,
    ];

    for (const line of logLines) {
      for (const pattern of errorPatterns) {
        if (pattern.test(line)) {
          errors.push(line.trim());
          break;
        }
      }
    }

    return errors;
  }

  /**
   * Schedules automatic server switching.
   */
  private scheduleAutoSwitch(): void {
    if (this.reconnectTimeout) {
      return; // Уже запланировано переключение
    }

    logger.info('ConnectionMonitorService', 'Scheduling auto-switch');
    
    // Переключаемся через 5 секунд после обнаружения проблемы
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.attemptAutoSwitch();
    }, 5000);
  }

  /**
   * Attempts to automatically switch to another server.
   */
  private async attemptAutoSwitch(): Promise<void> {
    if (!this.status.currentServer) {
      return;
    }

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

    if (nextServer) {
      logger.info('ConnectionMonitorService', 'Switching to server', {
        from: this.status.currentServer.name,
        to: nextServer.name,
      });

      this.emit('switching', {
        type: 'switching',
        server: nextServer,
        message: `Switching from ${this.status.currentServer.name} to ${nextServer.name}`,
      } as ConnectionEvent);

      // Переключаемся на новый сервер
      await this.switchToServer(nextServer);
    }
  }

  /**
   * Switches to a different server.
   */
  private async switchToServer(server: VlessConfig): Promise<void> {
    try {
      const connectionMode = configService.getConnectionMode();

      // Отключаемся от текущего сервера
      await systemProxyService.disable();
      await tunRouteService.disable();
      xrayService.stop();

      // Небольшая задержка перед переподключением
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Подключаемся к новому серверу
      await xrayService.start(server, connectionMode);
      if (connectionMode === 'proxy') {
        await systemProxyService.enable(APP_CONSTANTS.PORTS.HTTP, APP_CONSTANTS.PORTS.SOCKS);
      } else {
        await systemProxyService.disable();
        await tunRouteService.enable(server);
      }
      
      configService.setSelectedServerId(server.uuid);
      
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
        await systemProxyService.disable();
        await tunRouteService.disable();
        xrayService.stop();
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
