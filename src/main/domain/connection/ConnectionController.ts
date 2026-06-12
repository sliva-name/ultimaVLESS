import { EventEmitter } from 'events';
import { app } from 'electron';
import { APP_CONSTANTS } from '@/shared/constants';
import { ConnectionMode, VlessConfig } from '@/shared/types';
import {
  configService,
  ConfigService,
} from '@/main/services/ConfigService';
import {
  connectionMonitorService,
  ConnectionMonitorService,
} from '@/main/services/ConnectionMonitorService';
import {
  hasTunPrivileges,
  requestTunPrivilegesRelaunch,
} from '@/main/services/PrivilegeService';
import {
  systemProxyService,
  SystemProxyService,
} from '@/main/services/SystemProxyService';
import { tunRouteService, TunRouteService } from '@/main/services/TunRouteService';
import { xrayService, XrayService } from '@/main/services/XrayService';
import { logger } from '@/main/services/LoggerService';
import {
  ConnectionStrategy,
  createConnectionStrategies,
  createNetworkTeardown,
  NetworkTeardown,
  ProxyPorts,
} from './connectionStrategies';

interface ConnectionControllerDeps {
  app: {
    releaseSingleInstanceLock: () => void;
    quit: () => void;
  };
  constants: { ports: ProxyPorts };
  configService: ConfigService;
  connectionMonitorService: ConnectionMonitorService;
  hasTunPrivileges: typeof hasTunPrivileges;
  requestTunPrivilegesRelaunch: typeof requestTunPrivilegesRelaunch;
  proxyService: SystemProxyService;
  routeService: TunRouteService;
  coreService: XrayService;
  strategies?: Record<ConnectionMode, ConnectionStrategy>;
  teardown?: NetworkTeardown;
}

export class ConnectionControllerRelaunchError extends Error {
  public readonly relaunched = true;

  constructor(message = 'Restarting as administrator') {
    super(message);
    this.name = 'ConnectionControllerRelaunchError';
  }
}

export type ConnectionControllerState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'switching'
  | 'disconnecting'
  | 'failed';

export class ConnectionController extends EventEmitter {
  private operationQueue: Promise<void> = Promise.resolve();
  private state: ConnectionControllerState = 'idle';
  private activeOperation: Promise<unknown> | null = null;
  private readonly strategies: Record<ConnectionMode, ConnectionStrategy>;
  private readonly teardown: NetworkTeardown;

  constructor(
    private readonly deps: ConnectionControllerDeps = {
      app,
      constants: {
        ports: {
          http: APP_CONSTANTS.PORTS.HTTP,
          socks: APP_CONSTANTS.PORTS.SOCKS,
        },
      },
      configService,
      connectionMonitorService,
      hasTunPrivileges,
      requestTunPrivilegesRelaunch,
      proxyService: systemProxyService,
      routeService: tunRouteService,
      coreService: xrayService,
    },
  ) {
    super();
    this.strategies =
      deps.strategies ??
      createConnectionStrategies({
        proxyService: deps.proxyService,
        routeService: deps.routeService,
        coreService: deps.coreService,
        configService: deps.configService,
      });
    this.teardown =
      deps.teardown ??
      createNetworkTeardown({
        proxyService: deps.proxyService,
        routeService: deps.routeService,
        coreService: deps.coreService,
      });
  }

  public getState(): ConnectionControllerState {
    return this.state;
  }

  public isBusy(): boolean {
    return this.activeOperation !== null;
  }

  private setState(state: ConnectionControllerState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit('state-changed', state);
  }

  private enqueue<T>(
    operationName: ConnectionControllerState,
    task: () => Promise<T>,
  ): Promise<T> {
    const run = this.operationQueue.then(async () => {
      this.setState(operationName);
      const operation = task();
      this.activeOperation = operation;
      this.emit('busy-changed', true);
      try {
        const result = await operation;
        if (operationName === 'connecting' || operationName === 'switching') {
          this.setState('connected');
        } else if (operationName === 'disconnecting') {
          this.setState('idle');
        } else {
          this.setState('failed');
        }
        return result;
      } catch (error) {
        this.setState('failed');
        throw error;
      } finally {
        this.activeOperation = null;
        this.emit('busy-changed', false);
      }
    });
    this.operationQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private getServer(serverId: string): VlessConfig {
    const server = this.deps.configService
      .getServers()
      .find((candidate) => candidate.uuid === serverId);
    if (!server) {
      throw new Error('Selected server was not found in local configuration');
    }
    return server;
  }

  private async applyConnectionMode(
    server: VlessConfig,
    mode: ConnectionMode,
    ports: ProxyPorts,
  ): Promise<void> {
    await this.strategies[mode].apply(server, ports);
  }

  private async ensureTunReady(server: VlessConfig): Promise<void> {
    if (!this.deps.routeService.isSupported()) {
      throw new Error(
        this.deps.routeService.getUnsupportedReason() ||
          'TUN mode is not supported on this operating system.',
      );
    }

    if (await this.deps.hasTunPrivileges()) {
      return;
    }

    if (process.platform === 'win32') {
      this.deps.configService.setSelectedServerId(server.uuid);
      this.deps.configService.setPendingTunReconnect(server.uuid);
      const relaunched = await this.deps.requestTunPrivilegesRelaunch();
      if (relaunched) {
        this.deps.app.releaseSingleInstanceLock();
        this.deps.app.quit();
        throw new ConnectionControllerRelaunchError();
      }
      this.deps.configService.clearPendingTunReconnect();
      throw new Error(
        'TUN mode requires Administrator rights. Please approve UAC prompt or run UltimaVLESS as Administrator.',
      );
    }

    throw new Error(
      'TUN mode requires root privileges on this operating system. Please run the app with elevated permissions.',
    );
  }

  private async connectUnsafe(serverId: string): Promise<void> {
    const server = this.getServer(serverId);
    const mode = this.deps.configService.getConnectionMode();
    const monitorStatus = this.deps.connectionMonitorService.getStatus();

    // Skip only when the stack is verifiably alive: a degraded/failed health
    // state (or unreachable local proxy) means proxy/TUN may have been torn
    // down by a failure cleanup, so a manual connect must do a full reconnect.
    if (
      this.deps.coreService.isRunning() &&
      monitorStatus.isConnected &&
      monitorStatus.currentServer?.uuid === server.uuid &&
      (monitorStatus.lastHealthState === 'healthy' ||
        monitorStatus.lastHealthState === 'idle') &&
      monitorStatus.localProxyReachable !== false
    ) {
      logger.info('ConnectionController', 'connect skipped: already connected', {
        serverId: server.uuid.substring(0, 8),
        mode,
      });
      return;
    }

    if (mode === 'tun') {
      await this.ensureTunReady(server);
    }

    await this.teardown.reset({ stopXray: true });
    await this.applyConnectionMode(server, mode, this.deps.constants.ports);
    this.deps.configService.clearPendingTunReconnect();
    this.deps.configService.setSelectedServerId(server.uuid);
    this.deps.connectionMonitorService.startMonitoring(server);
  }

  public connect(serverId: string): Promise<void> {
    return this.enqueue('connecting', () => this.connectUnsafe(serverId));
  }

  public disconnect(): Promise<void> {
    return this.enqueue('disconnecting', async () => {
      this.deps.configService.clearPendingTunReconnect();
      // Stop monitoring before teardown: if teardown throws, the monitor must
      // not keep reporting "connected" for a stack that is being dismantled.
      this.deps.connectionMonitorService.stopMonitoring({
        message: 'Disconnected',
      });
      await this.teardown.reset({ stopXray: true });
    });
  }

  public switchToServer(server: VlessConfig): Promise<void> {
    return this.enqueue('switching', async () => {
      const mode = this.deps.configService.getConnectionMode();
      await this.teardown.reset({ stopXray: true });
      await this.applyConnectionMode(server, mode, this.deps.constants.ports);
      this.deps.configService.setSelectedServerId(server.uuid);
      this.deps.connectionMonitorService.startMonitoring(server);
    });
  }

  public transitionForAutoSwitch(server: VlessConfig): Promise<void> {
    return this.enqueue('switching', async () => {
      const mode = this.deps.configService.getConnectionMode();
      await this.teardown.reset({ stopXray: true });
      await this.applyConnectionMode(server, mode, this.deps.constants.ports);
    });
  }

  public resumePendingTun(serverId: string): Promise<boolean> {
    if (this.deps.configService.getConnectionMode() !== 'tun') {
      return Promise.resolve(false);
    }
    return this.enqueue('connecting', async () => {
      const server = this.getServer(serverId);
      await this.ensureTunReady(server);
      await this.teardown.reset({ stopXray: true });
      await this.applyConnectionMode(server, 'tun', this.deps.constants.ports);
      this.deps.configService.setSelectedServerId(server.uuid);
      this.deps.connectionMonitorService.startMonitoring(server);
      return true;
    });
  }

  public cleanupAfterFailure(): Promise<void> {
    return this.enqueue('failed', async () => {
      await this.teardown.reset({ stopXray: true });
    });
  }
}

export const connectionController = new ConnectionController();
