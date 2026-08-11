import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { EventEmitter } from 'events';
import { app } from 'electron';
import { ConnectionMode, VlessConfig } from '@/shared/types';
import { XrayHealthStatus } from '@/shared/ipc';
import { APP_CONSTANTS } from '@/shared/constants';
import { XrayConfigCompiler } from './XrayConfigCompiler';
import { configService } from './ConfigService';
import { logger } from './LoggerService';
import { probeTcpPort } from './networkProbe';
import { getBinResourcesPath } from '@/main/utils/runtimePaths';
import { resolveSystemBinary } from './platform/systemBinaries';

export interface XrayUnexpectedExitEvent {
  config: VlessConfig;
  code: number | null;
  signal: NodeJS.Signals | null;
  reason: string;
}

export interface XrayStartOptions {
  sendThrough?: string;
  tunAutoRoute?: boolean;
}

/**
 * Service responsible for managing the Xray-core process.
 * Handles configuration generation, process spawning, and lifecycle management.
 */
export class XrayService extends EventEmitter {
  private process: ChildProcess | null = null;
  private resourcesPath: string;
  /** Max wait for SOCKS/HTTP listeners (also covers early-crash detection). */
  private static readonly READINESS_TIMEOUT_MS = 3000;
  private static readonly READINESS_RETRY_MS = 50;
  /** Short connect timeout so failed polls do not burn the readiness budget. */
  private static readonly READINESS_PROBE_TIMEOUT_MS = 200;
  private static readonly STOP_TIMEOUT_MS = 3000;
  private readonly expectedExitProcesses = new WeakSet<ChildProcess>();
  private readonly notifiedUnexpectedExitProcesses =
    new WeakSet<ChildProcess>();
  private stopWaitPromise: Promise<void> | null = null;
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

  constructor() {
    super();
    this.resourcesPath = getBinResourcesPath();

    logger.info('XrayService', 'Initialized', {
      resourcesPath: this.resourcesPath,
    });
  }

  /**
   * Starts the Xray process with the provided configuration.
   * Stops any existing process before starting a new one.
   *
   * @param {VlessConfig} config - The VLESS server configuration.
   * @param {ConnectionMode} [connectionMode='proxy'] - Whether Xray runs in SOCKS/HTTP proxy mode or TUN mode.
   * @param {XrayStartOptions} [options={}] - Runtime options forwarded to the Xray compiler.
   * @throws {Error} If config generation fails or binary is missing.
   * @returns {Promise<void>} Resolves when process is successfully spawned.
   */
  public async start(
    config: VlessConfig,
    connectionMode: ConnectionMode = 'proxy',
    options: XrayStartOptions = {},
  ): Promise<void> {
    this.stop();
    await this.awaitPendingStop();
    this.setHealthStatus({
      state: 'starting',
      ready: false,
      xrayRunning: false,
      localProxyReachable: null,
      lastReadinessCheckAt: null,
      lastReadinessError: null,
    });

    const userDataPath = app.getPath('userData');
    const configPath = path.join(userDataPath, 'config.json');
    const logPath = path.join(userDataPath, 'xray.log');

    logger.info('XrayService', 'Starting Xray', {
      configPath,
      logPath,
      serverName: config.name,
      serverAddress: `${config.address}:${config.port}`,
      protocol: config.protocol || 'vless',
      transport: config.type || 'tcp',
      security: config.security || 'none',
      connectionMode,
      sendThrough: options.sendThrough || null,
    });

    let xrayConfig;
    try {
      xrayConfig = XrayConfigCompiler.compile(config, {
        logPath,
        connectionMode,
        ...options,
        performanceSettings: configService.getPerformanceSettings(),
      });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      this.markFailed(`Config generation failed: ${error.message}`);
      logger.error('XrayService', 'Failed to generate Xray config', error);
      throw error;
    }

    try {
      await fsPromises.writeFile(
        configPath,
        JSON.stringify(xrayConfig, null, 2),
      );
      logger.info('XrayService', 'Config written to disk');
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      this.markFailed(error.message);
      logger.error('XrayService', 'Failed to write config', error);
      throw error;
    }

    const binName = process.platform === 'win32' ? 'xray.exe' : 'xray';
    const binPath = path.join(this.resourcesPath, binName);

    try {
      await fsPromises.access(binPath, fs.constants.F_OK);
    } catch {
      const error = new Error(`Xray binary not found at: ${binPath}`);
      this.markFailed(error.message);
      logger.error('XrayService', 'Binary not found', error);
      throw error;
    }
    if (process.platform !== 'win32') {
      try {
        await fsPromises.chmod(binPath, 0o755);
      } catch (error) {
        logger.warn(
          'XrayService',
          'Failed to ensure executable mode for Xray binary',
          {
            binPath,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    let spawnedProcess: ChildProcess;
    try {
      spawnedProcess = spawn(binPath, ['-c', configPath], {
        env: {
          ...process.env,
          XRAY_LOCATION_ASSET: this.resourcesPath,
        },
      });
      this.process = spawnedProcess;
      logger.info('XrayService', 'Process spawned', {
        pid: spawnedProcess.pid,
      });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      this.markFailed(error.message);
      logger.error('XrayService', 'Spawn failed', error);
      throw error;
    }

    spawnedProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      const lines: string[] = output
        .split(/\r?\n/)
        .map((line: string) => line.trim())
        .filter(Boolean);
      for (const line of lines) {
        this.logXrayLine('stdout', line, config);
      }
    });

    spawnedProcess.stderr?.on('data', (data) => {
      const output = data.toString();
      const lines: string[] = output
        .split(/\r?\n/)
        .map((line: string) => line.trim())
        .filter(Boolean);
      for (const line of lines) {
        this.logXrayLine('stderr', line, config);
      }
    });

    spawnedProcess.on('close', (code) => {
      const signal = spawnedProcess.signalCode ?? null;
      const wasExpectedExit = this.expectedExitProcesses.has(spawnedProcess);
      logger.warn('XrayService', 'Process exited', {
        code,
        signal,
        server: config.name,
        serverAddress: `${config.address}:${config.port}`,
        exitCode: code,
      });
      this.maybeEmitUnexpectedExit(spawnedProcess, config, {
        code,
        signal,
        reason: `Xray exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'none'})`,
      });
      if (this.process === spawnedProcess) {
        this.process = null;
      }
      if (wasExpectedExit && this.process === null) {
        this.setHealthStatus({
          state: 'stopped',
          ready: false,
          xrayRunning: false,
          localProxyReachable: false,
        });
      }
    });

    spawnedProcess.on('error', (err) => {
      logger.error('XrayService', 'Process error', {
        error: err.message,
        stack: err.stack,
        server: config.name,
        serverAddress: `${config.address}:${config.port}`,
      });
      this.maybeEmitUnexpectedExit(spawnedProcess, config, {
        code: null,
        signal: null,
        reason: `Xray process error: ${err.message}`,
      });
    });

    try {
      // Poll listeners immediately while watching for early process death —
      // no fixed grace sleep (previously 1.2s even when ports were already up).
      const readiness = await this.awaitLocalProxyReadiness(spawnedProcess);
      if (!readiness.reachable) {
        const reason =
          readiness.reason ||
          'Xray started but local proxy listeners did not become reachable in time';
        // Kill before dropping the reference so a readiness timeout cannot leave
        // a live xray holding 10808/10809 while the UI later claims Connected.
        if (this.process === spawnedProcess) {
          this.expectedExitProcesses.add(spawnedProcess);
          try {
            spawnedProcess.kill();
          } catch {
            // Process already exited.
          }
          this.process = null;
        }
        this.markFailed(reason);
        throw new Error(reason);
      }
      if (this.process === spawnedProcess) {
        this.setHealthStatus({
          state: 'running',
          ready: true,
          xrayRunning: true,
          lastStartAt: Date.now(),
          lastReadyAt: Date.now(),
          lastReadinessCheckAt: Date.now(),
          localProxyReachable: true,
          lastFailureAt: null,
          lastFailureReason: null,
          lastReadinessError: null,
        });
      }
    } catch (error) {
      if (this.process === spawnedProcess) {
        // Kill the child before dropping the reference, otherwise a startup
        // failure leaks a live xray process holding the local proxy ports.
        this.expectedExitProcesses.add(spawnedProcess);
        try {
          spawnedProcess.kill();
        } catch {
          // Process already exited or never spawned.
        }
        this.process = null;
      }
      if (this.healthStatus.state === 'starting') {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.markFailed(errorMessage);
      }
      throw error;
    }
  }

  /**
   * Stops the running Xray process if one exists.
   */
  public stop(): void {
    if (this.process) {
      const processToStop = this.process;
      logger.info('XrayService', 'Stopping process...');
      this.setHealthStatus({
        state: 'stopping',
        ready: false,
        xrayRunning: false,
      });
      this.expectedExitProcesses.add(processToStop);
      const waitForExit = this.waitForProcessExit(processToStop);
      this.stopWaitPromise = waitForExit;
      void waitForExit.finally(() => {
        if (this.stopWaitPromise === waitForExit) {
          this.stopWaitPromise = null;
        }
      });
      try {
        processToStop.kill();
      } catch (error) {
        logger.warn('XrayService', 'Failed to stop Xray process cleanly', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      // `this.process` reference is cleared by the 'close' event handler in
      // `start()`. Until then, `isRunning()` still reports `true` thanks to
      // `stopWaitPromise`, so callers cannot race a half-stopped process.
      // SIGKILL is sent by `waitForProcessExit` if the child does not exit
      // within `STOP_TIMEOUT_MS`.
    }
  }

  /**
   * Synchronous best-effort kill for fatal / process-exit paths where we cannot
   * await graceful shutdown. Prefer {@link stop} during normal teardown.
   */
  public killSyncBestEffort(): void {
    const child = this.process;
    if (!child?.pid) return;
    this.expectedExitProcesses.add(child);
    try {
      if (process.platform === 'win32') {
        spawn(
          resolveSystemBinary('taskkill'),
          ['/pid', String(child.pid), '/T', '/F'],
          { windowsHide: true, detached: false, stdio: 'ignore' },
        ).unref();
      } else {
        try {
          process.kill(child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
    } catch {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }
    this.process = null;
  }

  /**
   * Checks if the Xray process is currently running.
   * @returns {boolean} True if running, false otherwise.
   */
  public isRunning(): boolean {
    return this.process !== null || this.stopWaitPromise !== null;
  }

  public getHealthStatus(): XrayHealthStatus {
    return {
      ...this.healthStatus,
      xrayRunning:
        this.process !== null &&
        this.healthStatus.state !== 'stopped' &&
        this.healthStatus.state !== 'failed',
    };
  }

  private maybeEmitUnexpectedExit(
    processRef: ChildProcess,
    config: VlessConfig,
    event: Omit<XrayUnexpectedExitEvent, 'config'>,
  ): void {
    if (
      this.expectedExitProcesses.has(processRef) ||
      this.notifiedUnexpectedExitProcesses.has(processRef)
    ) {
      return;
    }
    this.notifiedUnexpectedExitProcesses.add(processRef);
    this.markFailed(event.reason);
    this.emit('unexpected-exit', {
      ...event,
      config,
    } satisfies XrayUnexpectedExitEvent);
  }

  private markFailed(reason: string): void {
    this.setHealthStatus({
      state: 'failed',
      ready: false,
      xrayRunning: false,
      localProxyReachable: false,
      lastReadinessCheckAt: Date.now(),
      lastFailureAt: Date.now(),
      lastFailureReason: reason,
      lastReadinessError: reason,
    });
  }

  private setHealthStatus(next: Partial<XrayHealthStatus>): void {
    const updatedStatus: XrayHealthStatus = {
      ...this.healthStatus,
      ...next,
    };
    const changed =
      updatedStatus.state !== this.healthStatus.state ||
      updatedStatus.ready !== this.healthStatus.ready ||
      updatedStatus.xrayRunning !== this.healthStatus.xrayRunning ||
      updatedStatus.lastStartAt !== this.healthStatus.lastStartAt ||
      updatedStatus.lastReadyAt !== this.healthStatus.lastReadyAt ||
      updatedStatus.lastReadinessCheckAt !==
        this.healthStatus.lastReadinessCheckAt ||
      updatedStatus.localProxyReachable !==
        this.healthStatus.localProxyReachable ||
      updatedStatus.lastFailureAt !== this.healthStatus.lastFailureAt ||
      updatedStatus.lastFailureReason !== this.healthStatus.lastFailureReason ||
      updatedStatus.lastReadinessError !== this.healthStatus.lastReadinessError;

    this.healthStatus = updatedStatus;
    if (changed) {
      this.emit('health-changed', this.getHealthStatus());
    }
  }

  private async awaitLocalProxyReadiness(
    processRef: ChildProcess,
  ): Promise<{ reachable: boolean; reason: string | null }> {
    type ProcessEventHandler = (...args: never[]) => void;
    let exitReject: ((error: Error) => void) | null = null;
    const exitPromise = new Promise<never>((_resolve, reject) => {
      exitReject = reject;
    });

    const onCloseDuringStartup = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ) => {
      exitReject?.(
        new Error(
          `Xray exited during startup (code=${code ?? 'null'}, signal=${signal ?? 'none'})`,
        ),
      );
    };
    const onErrorDuringStartup = (error: Error) => {
      exitReject?.(error);
    };

    const withOnce = processRef as ChildProcess & {
      once?: (event: string, listener: ProcessEventHandler) => ChildProcess;
      off?: (event: string, listener: ProcessEventHandler) => ChildProcess;
      removeListener?: (
        event: string,
        listener: ProcessEventHandler,
      ) => ChildProcess;
    };
    withOnce.once?.('close', onCloseDuringStartup);
    withOnce.once?.('error', onErrorDuringStartup);

    const detachExitWatchers = (): void => {
      if (typeof withOnce.off === 'function') {
        withOnce.off('close', onCloseDuringStartup);
        withOnce.off('error', onErrorDuringStartup);
        return;
      }
      withOnce.removeListener?.('close', onCloseDuringStartup);
      withOnce.removeListener?.('error', onErrorDuringStartup);
    };

    const pollReady = async (): Promise<{
      reachable: boolean;
      reason: string | null;
    }> => {
      const startedAt = Date.now();
      while (Date.now() - startedAt <= XrayService.READINESS_TIMEOUT_MS) {
        if (this.process !== processRef) {
          throw new Error(
            'Xray process exited before local proxy listeners became ready',
          );
        }

        const [socksReady, httpReady] = await Promise.all([
          probeTcpPort(
            APP_CONSTANTS.PORTS.SOCKS,
            '127.0.0.1',
            XrayService.READINESS_PROBE_TIMEOUT_MS,
          ),
          probeTcpPort(
            APP_CONSTANTS.PORTS.HTTP,
            '127.0.0.1',
            XrayService.READINESS_PROBE_TIMEOUT_MS,
          ),
        ]);
        const reachable = socksReady && httpReady;
        const checkedAt = Date.now();

        if (reachable) {
          this.setHealthStatus({
            lastReadinessCheckAt: checkedAt,
            localProxyReachable: true,
            lastReadinessError: null,
            lastReadyAt: checkedAt,
          });
          return { reachable: true, reason: null };
        }

        this.setHealthStatus({
          lastReadinessCheckAt: checkedAt,
          localProxyReachable: false,
          lastReadinessError: 'Local proxy listeners are not reachable yet',
        });
        await new Promise((resolve) =>
          setTimeout(resolve, XrayService.READINESS_RETRY_MS),
        );
      }

      return {
        reachable: false,
        reason:
          'Xray started but local proxy listeners did not become reachable in time',
      };
    };

    try {
      return await Promise.race([pollReady(), exitPromise]);
    } finally {
      detachExitWatchers();
    }
  }

  private logXrayLine(
    stream: 'stdout' | 'stderr',
    line: string,
    config: VlessConfig,
  ): void {
    const normalized = line.toLowerCase();
    const metadata = {
      stream,
      data: line,
      server: config.name,
      serverAddress: `${config.address}:${config.port}`,
    };

    if (
      normalized.includes('[error]') ||
      normalized.includes('failed to start')
    ) {
      logger.error('XrayService', 'Xray runtime error', metadata);
      return;
    }

    if (normalized.includes('[warning]') || normalized.includes('deprecated')) {
      logger.warn('XrayService', 'Xray runtime warning', metadata);
      return;
    }

    logger.debug('XrayService', 'Xray runtime output', metadata);
  }

  private async awaitPendingStop(): Promise<void> {
    const waitForExit = this.stopWaitPromise;
    if (!waitForExit) {
      return;
    }
    await waitForExit;
  }

  private waitForProcessExit(processRef: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      let timeoutId: NodeJS.Timeout | null = null;
      type ProcessEventHandler = () => void;

      const cleanup = (
        onClose: ProcessEventHandler,
        onError: ProcessEventHandler,
      ): void => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        const withOff = processRef as ChildProcess & {
          off?: (event: string, listener: ProcessEventHandler) => ChildProcess;
        };
        if (typeof withOff.off === 'function') {
          withOff.off('close', onClose);
          withOff.off('error', onError);
          return;
        }
        const withRemove = processRef as ChildProcess & {
          removeListener?: (
            event: string,
            listener: ProcessEventHandler,
          ) => ChildProcess;
        };
        if (typeof withRemove.removeListener === 'function') {
          withRemove.removeListener('close', onClose);
          withRemove.removeListener('error', onError);
        }
      };

      const finish = (
        onClose: ProcessEventHandler,
        onError: ProcessEventHandler,
      ): void => {
        if (settled) return;
        settled = true;
        cleanup(onClose, onError);
        resolve();
      };

      const onClose = () => finish(onClose, onError);
      const onError = () => finish(onClose, onError);

      processRef.once('close', onClose);
      processRef.once('error', onError);
      timeoutId = setTimeout(() => {
        logger.warn(
          'XrayService',
          'Timed out waiting for Xray to exit, sending SIGKILL',
          {
            timeoutMs: XrayService.STOP_TIMEOUT_MS,
            pid: processRef.pid ?? null,
          },
        );
        try {
          processRef.kill('SIGKILL');
        } catch {
          // ignore
        }
        finish(onClose, onError);
      }, XrayService.STOP_TIMEOUT_MS);
    });
  }

}

export const xrayService = new XrayService();
