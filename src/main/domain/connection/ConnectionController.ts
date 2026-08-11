import { EventEmitter } from 'events';
import { app } from 'electron';
import { APP_CONSTANTS } from '@/shared/constants';
import type { SessionPhase } from '@/shared/ipc';
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

/** @deprecated Use SessionPhase from shared/ipc */
export type ConnectionControllerState = SessionPhase;

const ALLOWED_TRANSITIONS: Record<SessionPhase, readonly SessionPhase[]> = {
  idle: ['connecting', 'disconnecting', 'failed'],
  connecting: ['connected', 'failed', 'disconnecting'],
  connected: ['disconnecting', 'switching', 'connecting', 'failed'],
  switching: ['connected', 'failed', 'disconnecting'],
  disconnecting: ['idle', 'failed'],
  failed: ['idle', 'connecting', 'disconnecting', 'switching'],
};

export class ConnectionController extends EventEmitter {
  private operationQueue: Promise<void> = Promise.resolve();
  private phase: SessionPhase = 'idle';
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

  public getPhase(): SessionPhase {
    return this.phase;
  }

  /** @deprecated Use getPhase() */
  public getState(): SessionPhase {
    return this.phase;
  }

  public isBusy(): boolean {
    return (
      this.phase === 'connecting' ||
      this.phase === 'disconnecting' ||
      this.phase === 'switching' ||
      this.activeOperation !== null
    );
  }

  private transitionTo(next: SessionPhase): void {
    if (this.phase === next) return;
    const allowed = ALLOWED_TRANSITIONS[this.phase];
    if (!allowed.includes(next)) {
      logger.warn('ConnectionController', 'Unexpected phase transition', {
        from: this.phase,
        to: next,
      });
    }
    this.phase = next;
    this.emit('phase-changed', next);
  }

  private enqueue<T>(
    operationPhase: Extract<
      SessionPhase,
      'connecting' | 'disconnecting' | 'switching'
    >,
    task: () => Promise<T>,
  ): Promise<T> {
    const run = this.operationQueue.then(async () => {
      // Phase first — before any sync side effects inside the task — so the UI
      // never sees monitor/teardown updates under the wrong verb.
      this.activeOperation = Promise.resolve();
      this.transitionTo(operationPhase);
      try {
        const result = await task();
        if (operationPhase === 'disconnecting') {
          this.transitionTo('idle');
        } else {
          this.transitionTo('connected');
        }
        return result;
      } catch (error) {
        // Elevation relaunch intentionally aborts connect; the process is
        // quitting. Do not mark failed — pendingTunReconnect must survive
        // shutdown teardown for the elevated instance to resume.
        if (!(error instanceof ConnectionControllerRelaunchError)) {
          this.transitionTo('failed');
        }
        throw error;
      } finally {
        this.activeOperation = null;
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

  public disconnect(
    options: { preservePendingTunReconnect?: boolean } = {},
  ): Promise<void> {
    return this.enqueue('disconnecting', async () => {
      // App quit after UAC relaunch must keep pendingTunReconnect so the
      // elevated process can resumePendingTun on startup.
      if (!options.preservePendingTunReconnect) {
        this.deps.configService.clearPendingTunReconnect();
      }
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
      await this.teardown.reset({
        stopXray: true,
        keepSystemProxy: mode === 'proxy',
      });
      await this.applyConnectionMode(server, mode, this.deps.constants.ports);
      this.deps.configService.setSelectedServerId(server.uuid);
      this.deps.connectionMonitorService.startMonitoring(server);
    });
  }

  public transitionForAutoSwitch(server: VlessConfig): Promise<void> {
    return this.enqueue('switching', async () => {
      const mode = this.deps.configService.getConnectionMode();
      await this.teardown.reset({
        stopXray: true,
        keepSystemProxy: mode === 'proxy',
      });
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

  /**
   * Tear down the stack after a failure. Uses disconnecting (not failed) so the
   * UI shows teardown, then lands on idle — or failed if teardown itself throws.
   */
  public cleanupAfterFailure(): Promise<void> {
    return this.enqueue('disconnecting', async () => {
      this.deps.connectionMonitorService.stopMonitoring({
        message: 'Connection cleanup',
        preserveLastError: true,
      });
      await this.teardown.reset({ stopXray: true });
    });
  }
}

export const connectionController = new ConnectionController();
