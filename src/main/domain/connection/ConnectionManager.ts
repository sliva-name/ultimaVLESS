import { EventEmitter } from 'events';
import { app } from 'electron';
import { APP_CONSTANTS, PRIMARY_RUNTIME_PORTS } from '@/shared/constants';
import type { SessionPhase } from '@/shared/ipc';
import { VlessConfig } from '@/shared/types';
import { configService, ConfigService } from '@/main/services/ConfigService';
import {
  connectionMonitorService,
  ConnectionMonitorService,
  type HealthFailureEvent,
} from '@/main/services/ConnectionMonitorService';
import {
  hasTunPrivileges,
  requestTunPrivilegesRelaunch,
} from '@/main/services/PrivilegeService';
import {
  systemProxyService,
  SystemProxyService,
} from '@/main/services/SystemProxyService';
import {
  tunRouteService,
  TunRouteService,
} from '@/main/services/TunRouteService';
import { xrayService, XrayService } from '@/main/services/XrayService';
import { logger } from '@/main/services/LoggerService';
import { CONNECTION_MONITOR_TIMING } from '@/main/services/connectionMonitor/timing';
import type { ConnectionSpec } from './ConnectionSpec';
import {
  createConnectionRuntime,
  type ConnectionRuntime,
} from './ConnectionRuntime';
import {
  createProxyNetworkRuntime,
  createTunNetworkRuntime,
} from './NetworkModeRuntime';
import { createRuntimeValidator } from './RuntimeValidator';
import {
  ConnectionOperationAbortedError,
  isConnectionOperationCancelled,
  throwIfAborted,
} from './abort';
import {
  createAutoSwitchPolicy,
  type ConnectionPolicy,
} from './ConnectionPolicy';
import type { ServerRepository } from '@/main/domain/server/ServerRepository';
import { getServerRepository } from '@/main/infrastructure/persistence/ElectronServerRepository';
import {
  activeServerIdFromState,
  connectionStateToSessionPhase,
  isConnectionStateInFlight,
  lastErrorFromState,
  type ConnectionState,
} from './ConnectionState';

interface ConnectionManagerDeps {
  app: {
    releaseSingleInstanceLock: () => void;
    quit: () => void;
  };
  constants: { ports: typeof PRIMARY_RUNTIME_PORTS };
  configService: ConfigService;
  connectionMonitorService: ConnectionMonitorService;
  hasTunPrivileges: typeof hasTunPrivileges;
  requestTunPrivilegesRelaunch: typeof requestTunPrivilegesRelaunch;
  proxyService: SystemProxyService;
  routeService: TunRouteService;
  coreService: XrayService;
  runtime?: ConnectionRuntime;
  serverRepository?: ServerRepository;
  policy?: ConnectionPolicy;
}

export class ConnectionControllerRelaunchError extends Error {
  public readonly relaunched = true;

  constructor(message = 'Restarting as administrator') {
    super(message);
    this.name = 'ConnectionControllerRelaunchError';
  }
}

const ALLOWED_TRANSITIONS: Record<SessionPhase, readonly SessionPhase[]> = {
  idle: ['connecting', 'disconnecting', 'failed'],
  connecting: ['connected', 'failed', 'disconnecting'],
  connected: ['disconnecting', 'switching', 'connecting', 'failed'],
  switching: ['connected', 'failed', 'disconnecting'],
  disconnecting: ['idle', 'failed'],
  failed: ['idle', 'connecting', 'disconnecting', 'switching'],
};

type InFlightState = Extract<
  ConnectionState,
  { type: 'starting' | 'stopping' | 'switching' }
>;

/**
 * Session owner. The data plane (`ConnectionRuntime`) is transactional:
 * start/switch either finish up or tear themselves down.
 *
 * The queue has one running task. A new public call aborts the current task
 * and then enqueues the replacement. The aborted task must not touch the
 * stack — the replacement is the owner. There is no follow-up cleanup
 * enqueue after connect/switch.
 */
export class ConnectionManager extends EventEmitter {
  private operationQueue: Promise<void> = Promise.resolve();
  private state: ConnectionState = { type: 'disconnected' };
  private generation = 0;
  private activeOperation: Promise<unknown> | null = null;
  private operationAbort: AbortController | null = null;
  private autoSwitchTimer: NodeJS.Timeout | null = null;
  private healthPolicyArmed = false;
  private readonly runtime: ConnectionRuntime;
  private readonly servers: ServerRepository;
  private readonly policy: ConnectionPolicy;

  constructor(
    private readonly deps: ConnectionManagerDeps = {
      app,
      constants: {
        ports: {
          http: APP_CONSTANTS.PORTS.HTTP,
          socks: APP_CONSTANTS.PORTS.SOCKS,
          api: APP_CONSTANTS.PORTS.API,
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
    this.servers = deps.serverRepository ?? {
      get: (id) => getServerRepository().get(id),
      list: () => getServerRepository().list(),
      saveAll: (servers) => getServerRepository().saveAll(servers),
    };
    this.policy = deps.policy ?? createAutoSwitchPolicy();
    this.runtime =
      deps.runtime ??
      createConnectionRuntime({
        xray: deps.coreService,
        proxy: createProxyNetworkRuntime(deps.proxyService),
        tun: createTunNetworkRuntime(deps.routeService, deps.configService),
        validator: createRuntimeValidator({
          getXrayHealthStatus: () => deps.coreService.getHealthStatus(),
        }),
      });
  }

  public getConnectionState(): ConnectionState {
    return this.state;
  }

  public getPhase(): SessionPhase {
    return connectionStateToSessionPhase(this.state);
  }

  public getLastError(): string | null {
    return lastErrorFromState(this.state);
  }

  public isBusy(): boolean {
    return (
      isConnectionStateInFlight(this.state) || this.activeOperation !== null
    );
  }

  private nextGeneration(): number {
    this.generation += 1;
    return this.generation;
  }

  private abortCurrentOperation(): void {
    if (this.autoSwitchTimer) {
      clearTimeout(this.autoSwitchTimer);
      this.autoSwitchTimer = null;
    }
    this.healthPolicyArmed = false;
    this.operationAbort?.abort();
  }

  private buildSpec(server: VlessConfig): ConnectionSpec {
    return {
      server,
      mode: this.deps.configService.getConnectionMode(),
      ports: this.deps.constants.ports,
    };
  }

  private transitionTo(next: ConnectionState): void {
    const fromPhase = connectionStateToSessionPhase(this.state);
    const toPhase = connectionStateToSessionPhase(next);
    if (fromPhase !== toPhase) {
      const allowed = ALLOWED_TRANSITIONS[fromPhase];
      if (!allowed.includes(toPhase)) {
        throw new Error(
          `Illegal session transition ${fromPhase} → ${toPhase}`,
        );
      }
    }
    this.state = next;
    if (fromPhase !== toPhase) {
      this.emit('phase-changed', toPhase);
    }
    this.emit('state-changed', next);
  }

  private enqueue<T>(
    createInFlight: () => InFlightState,
    task: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const run = this.operationQueue.then(async () => {
      this.activeOperation = Promise.resolve();
      const abort = new AbortController();
      this.operationAbort = abort;
      const inFlight = createInFlight();
      this.transitionTo(inFlight);
      try {
        const result = await task(abort.signal);
        throwIfAborted(abort.signal);
        if (inFlight.type === 'stopping') {
          this.transitionTo(
            inFlight.outcome === 'failed'
              ? {
                  type: 'failed',
                  reason: inFlight.reason ?? {
                    message: 'Connection failed',
                  },
                }
              : { type: 'disconnected' },
          );
        } else {
          const serverId =
            this.state.type === 'switching'
              ? this.state.to
              : inFlight.type === 'starting'
                ? inFlight.serverId
                : inFlight.to;
          const mode =
            this.state.type === 'switching' || this.state.type === 'starting'
              ? this.state.mode
              : inFlight.mode;
          this.transitionTo({ type: 'connected', serverId, mode });
        }
        return result;
      } catch (error) {
        if (
          error instanceof ConnectionControllerRelaunchError ||
          isConnectionOperationCancelled(error) ||
          abort.signal.aborted
        ) {
          throw error;
        }
        this.transitionTo({
          type: 'failed',
          reason: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
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
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error('Selected server was not found in local configuration');
    }
    return server;
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

  private async connectUnsafe(
    serverId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const server = this.getServer(serverId);
    const spec = this.buildSpec(server);

    if (spec.mode === 'tun') {
      await this.ensureTunReady(server);
    }

    throwIfAborted(signal);
    await this.runtime.start(spec, signal);
    this.deps.configService.clearPendingTunReconnect();
    this.deps.configService.setSelectedServerId(server.uuid);
    this.deps.connectionMonitorService.startMonitoring(server);
  }

  public connect(serverId: string): Promise<void> {
    if (
      this.state.type === 'connected' &&
      this.state.serverId === serverId &&
      this.runtime.status().xrayRunning
    ) {
      return Promise.resolve();
    }
    this.abortCurrentOperation();
    return this.enqueue(
      () => ({
        type: 'starting',
        serverId,
        mode: this.deps.configService.getConnectionMode(),
        generation: this.nextGeneration(),
      }),
      (signal) => this.connectUnsafe(serverId, signal),
    );
  }

  public disconnect(
    options: { preservePendingTunReconnect?: boolean } = {},
  ): Promise<void> {
    this.abortCurrentOperation();
    return this.enqueue(
      () => ({
        type: 'stopping',
        generation: this.nextGeneration(),
        outcome: 'idle',
      }),
      async () => {
        this.healthPolicyArmed = false;
        if (!options.preservePendingTunReconnect) {
          this.deps.configService.clearPendingTunReconnect();
        }
        this.deps.connectionMonitorService.stopMonitoring({
          message: 'Disconnected',
        });
        await this.runtime.stop();
      },
    );
  }

  public switchToServer(server: VlessConfig): Promise<void> {
    this.abortCurrentOperation();
    return this.enqueue(
      () => ({
        type: 'switching',
        from: activeServerIdFromState(this.state) ?? '',
        to: server.uuid,
        mode: this.deps.configService.getConnectionMode(),
        generation: this.nextGeneration(),
      }),
      async (signal) => {
        await this.runtime.switch(this.buildSpec(server), signal);
        this.deps.configService.setSelectedServerId(server.uuid);
        this.deps.connectionMonitorService.startMonitoring(server);
      },
    );
  }

  public resumePendingTun(serverId: string): Promise<boolean> {
    if (this.deps.configService.getConnectionMode() !== 'tun') {
      return Promise.resolve(false);
    }
    this.abortCurrentOperation();
    return this.enqueue(
      () => ({
        type: 'starting',
        serverId,
        mode: 'tun' as const,
        generation: this.nextGeneration(),
      }),
      async (signal) => {
        const server = this.getServer(serverId);
        await this.ensureTunReady(server);
        await this.runtime.start(this.buildSpec(server), signal);
        this.deps.configService.setSelectedServerId(server.uuid);
        this.deps.connectionMonitorService.startMonitoring(server);
        return true;
      },
    );
  }

  public cleanupAfterFailure(reason?: string): Promise<void> {
    const message = reason ?? 'Connection cleanup';
    return this.enqueue(
      () => ({
        type: 'stopping',
        generation: this.nextGeneration(),
        outcome: 'failed',
        reason: { message },
      }),
      async () => {
        this.deps.connectionMonitorService.stopMonitoring({
          message,
          preserveLastError: true,
        });
        await this.runtime.stop();
      },
    );
  }

  public async handleHealthFailure(event: HealthFailureEvent): Promise<void> {
    if (this.state.type !== 'connected' || this.healthPolicyArmed) {
      return;
    }
    this.healthPolicyArmed = true;
    const monitor = this.deps.connectionMonitorService;
    monitor.pruneExpiredBlockedServers();
    const decision = this.policy.onHealthFailure({
      server: event.server,
      reason: event.reason,
      blocking: event.blocking,
      autoSwitchEnabled: monitor.getAutoSwitchingEnabled(),
      servers: this.servers.list(),
      blockedServerIds: new Set(monitor.getStatus().blockedServers),
    });

    if (decision.action === 'switch') {
      this.scheduleAutoSwitch(decision.candidates, event.server);
      return;
    }
    if (decision.action === 'disconnect') {
      try {
        await this.cleanupAfterFailure(event.reason);
      } catch (error) {
        logger.error(
          'ConnectionManager',
          'Cleanup after health failure failed',
          error,
        );
      } finally {
        this.healthPolicyArmed = false;
      }
      return;
    }
    this.healthPolicyArmed = false;
  }

  public async handleRuntimeFailure(
    reason: string,
    options: { localProxyReachable?: boolean | null } = {},
  ): Promise<void> {
    this.deps.connectionMonitorService.noteFailure(reason, options);
    if (this.state.type !== 'connected') {
      return;
    }
    const server = this.getServer(this.state.serverId);
    await this.handleHealthFailure({
      server,
      reason,
      blocking: true,
    });
  }

  private scheduleAutoSwitch(
    candidates: VlessConfig[],
    from: VlessConfig,
  ): void {
    if (this.autoSwitchTimer || this.state.type === 'switching') {
      return;
    }
    logger.info('ConnectionManager', 'Scheduling auto-switch', {
      from: from.name,
      candidateCount: candidates.length,
    });
    this.autoSwitchTimer = setTimeout(() => {
      this.autoSwitchTimer = null;
      void this.runAutoSwitch(candidates, from).finally(() => {
        this.healthPolicyArmed = false;
      });
    }, CONNECTION_MONITOR_TIMING.autoSwitchDelayMs);
  }

  private async runAutoSwitch(
    candidates: VlessConfig[],
    from: VlessConfig,
  ): Promise<void> {
    if (this.state.type !== 'connected') {
      return;
    }
    const monitor = this.deps.connectionMonitorService;
    try {
      await this.enqueue(
        () => ({
          type: 'switching',
          from: from.uuid,
          to: candidates[0]?.uuid ?? from.uuid,
          mode: this.deps.configService.getConnectionMode(),
          generation: this.nextGeneration(),
        }),
        async (signal) => {
          for (const candidate of candidates) {
            throwIfAborted(signal);
            this.transitionTo({
              type: 'switching',
              from: from.uuid,
              to: candidate.uuid,
              mode: this.deps.configService.getConnectionMode(),
              generation: this.generation,
            });
            monitor.notifySwitching(candidate, from.name);
            try {
              await this.runtime.switch(this.buildSpec(candidate), signal);
              this.deps.configService.setSelectedServerId(candidate.uuid);
              monitor.startMonitoring(candidate);
              logger.info('ConnectionManager', 'Auto-switch succeeded', {
                from: from.name,
                to: candidate.name,
              });
              return;
            } catch (error) {
              if (error instanceof ConnectionOperationAbortedError) {
                throw error;
              }
              const reason =
                error instanceof Error ? error.message : String(error);
              monitor.markServerAsBlocked(candidate.uuid);
              logger.warn('ConnectionManager', 'Auto-switch candidate failed', {
                server: candidate.name,
                reason,
              });
            }
          }
          monitor.stopMonitoring({
            message: 'Auto-switch failed',
            preserveLastError: true,
          });
          await this.runtime.stop();
          throw new Error('Auto-switch failed: no working servers found');
        },
      );
    } catch (error) {
      if (isConnectionOperationCancelled(error)) {
        return;
      }
      logger.error('ConnectionManager', 'Auto-switch failed', error);
    }
  }
}

export { ConnectionManager as ConnectionController };

export const connectionManager = new ConnectionManager();
export const connectionController = connectionManager;
