import { EventEmitter } from '../node/events';
import type { ConnectionMode, VlessConfig } from '@/shared/types';
import type { XrayHealthStatus } from '@/shared/ipc';
import { PRIMARY_RUNTIME_PORTS, type RuntimePorts } from '@/shared/constants';
import type { XrayStartOptions as DesktopXrayStartOptions } from '@desktop/main/services/XrayService';
import { XrayConfigCompiler } from '@/main/services/XrayConfigCompiler';
import { configService } from '@/main/services/ConfigService';
import { mainLocaleService } from '@/main/services/MainLocaleService';
import { probeTcpPort } from '@/main/services/networkProbe';
import { app } from '../electron';
import { logger } from './LoggerService';
import { UltimaCore, type CoreEvent } from '../native/UltimaCore';
import {
  adaptConfigForAndroid,
  buildVpnOptions,
  planAndroidRouting,
} from '../backend/androidConfig';

export type XrayStartOptions = DesktopXrayStartOptions;

export interface XrayUnexpectedExitEvent {
  config: VlessConfig;
  code: number | null;
  signal: string | null;
  reason: string;
}

/** Why the native side ended a session the WebView did not stop. */
export type NativeStopReason = Extract<CoreEvent, { type: 'stopped' }>;

const READINESS_TIMEOUT_MS = 3000;
const READINESS_RETRY_MS = 50;
const READINESS_PROBE_TIMEOUT_MS = 200;

/**
 * Android counterpart of the desktop process manager. Xray runs inside the
 * app's VpnService (libv2ray); this class compiles the config with the
 * desktop pipeline, hands it over, and mirrors the core's state.
 *
 * There is no staging slot: without `startStaging` the connection runtime
 * switches by stop + start, and the native side keeps the tunnel up across
 * that gap, so nothing leaks past the VPN while the next server comes up.
 *
 * Starting while the native core already runs the same session adopts it:
 * that is how the WebView picks up a session the tile, Always-on VPN or an
 * earlier WebView started.
 */
export class XrayService extends EventEmitter {
  private running = false;
  private activePorts: RuntimePorts = { ...PRIMARY_RUNTIME_PORTS };
  private currentServer: VlessConfig | null = null;
  private nativeQueue: Promise<unknown> = Promise.resolve();
  private healthStatus: XrayHealthStatus = {
    state: 'stopped',
    ready: false,
    xrayRunning: false,
    lastStartAt: null,
    lastReadyAt: null,
    lastReadinessCheckAt: null,
    localProxyReachable: null,
    lastFailureAt: null,
    lastFailureReason: null,
    lastReadinessError: null,
  };

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.nativeQueue.then(task, task);
    this.nativeQueue = run.catch(() => undefined);
    return run;
  }

  public async start(
    config: VlessConfig,
    connectionMode: ConnectionMode = 'proxy',
    options: XrayStartOptions = {},
  ): Promise<void> {
    const ports = options.ports ?? { ...PRIMARY_RUNTIME_PORTS };
    this.stop();
    this.activePorts = ports;
    this.currentServer = config;
    this.setHealthStatus({
      state: 'starting',
      ready: false,
      xrayRunning: false,
      lastStartAt: Date.now(),
      localProxyReachable: null,
      lastReadinessCheckAt: null,
      lastReadinessError: null,
    });

    const logPath = `${app.getPath('userData')}/xray.log`;
    const perf = configService.getPerformanceSettings();
    const plan = planAndroidRouting(perf, connectionMode);

    logger.info('XrayService', 'Starting Xray', {
      serverName: config.name,
      serverAddress: `${config.address}:${config.port}`,
      protocol: config.protocol || 'vless',
      transport: config.type || 'tcp',
      security: config.security || 'none',
      connectionMode,
      allowedApps: plan.allowedApps.length,
      disallowedApps: plan.disallowedApps.length,
    });

    let compiled: string;
    try {
      compiled = JSON.stringify(
        adaptConfigForAndroid(
          XrayConfigCompiler.compile(config, {
            logPath,
            connectionMode,
            ports,
            performanceSettings: plan.performanceSettings,
          }),
        ),
      );
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      this.markFailed(`Config generation failed: ${error.message}`);
      logger.error('XrayService', 'Failed to generate Xray config', error);
      throw error;
    }

    try {
      await this.enqueue(() =>
        UltimaCore.startCore({
          config: compiled,
          mode: connectionMode,
          serverId: config.uuid,
          sessionName: config.name,
          vpn:
            connectionMode === 'tun' ? buildVpnOptions(perf, plan) : undefined,
          text: {
            channelName: 'VPN',
            connected: mainLocaleService.t('tray.connectedTo', {
              name: config.name,
            }),
            proxyOnly: `${mainLocaleService.t('tray.connected')} · SOCKS5 127.0.0.1:${ports.socks} · HTTP 127.0.0.1:${ports.http}`,
            disconnect: mainLocaleService.t('tray.disconnect'),
          },
        }),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.markFailed(message);
      logger.error('XrayService', 'Native core failed to start', { message });
      throw new Error(message);
    }
    this.running = true;

    const ready = await this.waitForLocalProxy(ports);
    if (!ready) {
      const reason = `Xray did not open the local proxy on 127.0.0.1:${ports.socks}`;
      this.stopNative();
      this.markFailed(reason, { lastReadinessError: reason });
      throw new Error(reason);
    }
    this.setHealthStatus({
      state: 'running',
      ready: true,
      xrayRunning: true,
      lastReadyAt: Date.now(),
      lastReadinessCheckAt: Date.now(),
      localProxyReachable: true,
      lastFailureReason: null,
    });
    logger.info('XrayService', 'Xray is running', { mode: connectionMode });
  }

  private async waitForLocalProxy(ports: RuntimePorts): Promise<boolean> {
    const deadline = Date.now() + READINESS_TIMEOUT_MS;
    while (Date.now() <= deadline && this.running) {
      if (
        await probeTcpPort(ports.socks, '127.0.0.1', READINESS_PROBE_TIMEOUT_MS)
      ) {
        return true;
      }
      await new Promise((r) => setTimeout(r, READINESS_RETRY_MS));
    }
    return false;
  }

  public stop(): void {
    if (!this.running && this.healthStatus.state !== 'starting') {
      return;
    }
    logger.info('XrayService', 'Stopping core');
    this.stopNative();
    this.setHealthStatus({
      state: 'stopped',
      ready: false,
      xrayRunning: false,
    });
  }

  private stopNative(): void {
    this.running = false;
    void this.enqueue(() => UltimaCore.stopCore()).catch((error: unknown) => {
      logger.warn('XrayService', 'Failed to stop the native core', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  /**
   * The native side ended the session by itself. Returns the reason to the
   * session owner, which decides between a plain disconnect, a failure and
   * a recovery attempt.
   */
  public handleNativeStop(event: NativeStopReason): void {
    if (!this.running) return;
    this.running = false;
    if (event.reason === 'error') {
      const reason = event.message || 'Xray core stopped';
      this.markFailed(reason);
      if (this.currentServer) {
        this.emit('unexpected-exit', {
          config: this.currentServer,
          code: null,
          signal: null,
          reason,
        } satisfies XrayUnexpectedExitEvent);
      }
      return;
    }
    this.setHealthStatus({
      state: 'stopped',
      ready: false,
      xrayRunning: false,
    });
  }

  public killSyncBestEffort(): void {
    this.stop();
  }

  public isRunning(): boolean {
    return this.running;
  }

  public getActivePorts(): RuntimePorts {
    return { ...this.activePorts };
  }

  public getHealthStatus(): XrayHealthStatus {
    return {
      ...this.healthStatus,
      xrayRunning:
        this.running &&
        this.healthStatus.state !== 'stopped' &&
        this.healthStatus.state !== 'failed',
    };
  }

  private markFailed(
    reason: string,
    extra: Partial<XrayHealthStatus> = {},
  ): void {
    this.running = false;
    this.setHealthStatus({
      state: 'failed',
      ready: false,
      xrayRunning: false,
      lastFailureAt: Date.now(),
      lastFailureReason: reason,
      ...extra,
    });
  }

  private setHealthStatus(patch: Partial<XrayHealthStatus>): void {
    this.healthStatus = { ...this.healthStatus, ...patch };
    this.emit('health-changed', this.getHealthStatus());
  }
}

export const xrayService = new XrayService();
