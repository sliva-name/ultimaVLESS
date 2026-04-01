import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { app } from 'electron';
import { ConnectionMode, VlessConfig } from '../../shared/types';
import { ConfigGenerator, ConfigGeneratorOptions } from './ConfigGenerator';
import { logger } from './LoggerService';

export interface XrayUnexpectedExitEvent {
  config: VlessConfig;
  code: number | null;
  signal: NodeJS.Signals | null;
  reason: string;
}

/**
 * Service responsible for managing the Xray-core process.
 * Handles configuration generation, process spawning, and lifecycle management.
 */
export class XrayService extends EventEmitter {
  private process: ChildProcess | null = null;
  private resourcesPath: string;
  private static readonly STARTUP_GRACE_MS = 1200;
  private readonly expectedExitProcesses = new WeakSet<ChildProcess>();
  private readonly notifiedUnexpectedExitProcesses = new WeakSet<ChildProcess>();

  constructor() {
    super();
    this.resourcesPath = app.isPackaged 
      ? path.join(process.resourcesPath, 'bin')
      : path.join(process.cwd(), 'resources/bin');
    
    logger.info('XrayService', 'Initialized', { resourcesPath: this.resourcesPath });
  }

  /**
   * Starts the Xray process with the provided configuration.
   * Stops any existing process before starting a new one.
   * 
   * @param {VlessConfig} config - The VLESS server configuration.
   * @throws {Error} If config generation fails or binary is missing.
   * @returns {Promise<void>} Resolves when process is successfully spawned.
   */
  public async start(
    config: VlessConfig,
    connectionMode: ConnectionMode = 'proxy',
    options: ConfigGeneratorOptions = {}
  ): Promise<void> {
    this.stop();

    const userDataPath = app.getPath('userData');
    const configPath = path.join(userDataPath, 'config.json');
    const logPath = path.join(userDataPath, 'xray.log');
    
    logger.info('XrayService', 'Starting Xray', { 
      configPath, 
      logPath,
      serverName: config.name,
      serverAddress: `${config.address}:${config.port}`,
      protocol: config.type || 'tcp',
      security: config.security || 'none',
      connectionMode,
      sendThrough: options.sendThrough || null,
    });
    
    const xrayConfig = ConfigGenerator.generate(config, logPath, connectionMode, options);
    try {
      fs.writeFileSync(configPath, JSON.stringify(xrayConfig, null, 2));
      logger.info('XrayService', 'Config written to disk');
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      logger.error('XrayService', 'Failed to write config', error);
      throw error;
    }

    const binName = process.platform === 'win32' ? 'xray.exe' : 'xray';
    const binPath = path.join(this.resourcesPath, binName);

    if (!fs.existsSync(binPath)) {
      const error = new Error(`Xray binary not found at: ${binPath}`);
      logger.error('XrayService', 'Binary not found', error);
      throw error;
    }
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(binPath, 0o755);
      } catch (error) {
        logger.warn('XrayService', 'Failed to ensure executable mode for Xray binary', {
          binPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    let spawnedProcess: ChildProcess;
    try {
      spawnedProcess = spawn(binPath, ['-c', configPath], {
        env: {
          ...process.env,
          'XRAY_LOCATION_ASSET': this.resourcesPath
        }
      });
      this.process = spawnedProcess;
      logger.info('XrayService', 'Process spawned', { pid: spawnedProcess.pid });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
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

    await this.awaitStartupGracePeriod(spawnedProcess);
  }

  /**
   * Stops the running Xray process if one exists.
   */
  public stop(): void {
    if (this.process) {
      logger.info('XrayService', 'Stopping process...');
      this.expectedExitProcesses.add(this.process);
      this.process.kill();
      this.process = null;
    }
  }

  /**
   * Checks if the Xray process is currently running.
   * @returns {boolean} True if running, false otherwise.
   */
  public isRunning(): boolean {
    return this.process !== null;
  }

  private maybeEmitUnexpectedExit(
    processRef: ChildProcess,
    config: VlessConfig,
    event: Omit<XrayUnexpectedExitEvent, 'config'>
  ): void {
    if (this.expectedExitProcesses.has(processRef) || this.notifiedUnexpectedExitProcesses.has(processRef)) {
      return;
    }
    this.notifiedUnexpectedExitProcesses.add(processRef);
    this.emit('unexpected-exit', { ...event, config } satisfies XrayUnexpectedExitEvent);
  }

  private logXrayLine(stream: 'stdout' | 'stderr', line: string, config: VlessConfig): void {
    const normalized = line.toLowerCase();
    const metadata = {
      stream,
      data: line,
      server: config.name,
      serverAddress: `${config.address}:${config.port}`,
    };

    if (normalized.includes('[error]') || normalized.includes('failed to start')) {
      logger.error('XrayService', 'Xray runtime error', metadata);
      return;
    }

    if (normalized.includes('[warning]') || normalized.includes('deprecated')) {
      logger.warn('XrayService', 'Xray runtime warning', metadata);
      return;
    }

    logger.debug('XrayService', 'Xray runtime output', metadata);
  }

  private awaitStartupGracePeriod(processRef: ChildProcess): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeoutId: NodeJS.Timeout | null = null;
      type ProcessEventHandler = (...args: any[]) => void;

      const addListener = (event: 'close' | 'error', handler: ProcessEventHandler): boolean => {
        const withOnce = processRef as ChildProcess & { once?: (event: string, listener: ProcessEventHandler) => ChildProcess };
        if (typeof withOnce.once === 'function') {
          withOnce.once(event, handler);
          return true;
        }
        const withOn = processRef as ChildProcess & { on?: (event: string, listener: ProcessEventHandler) => ChildProcess };
        if (typeof withOn.on === 'function') {
          withOn.on(event, handler);
          return true;
        }
        return false;
      };

      const removeListener = (event: 'close' | 'error', handler: ProcessEventHandler): void => {
        const withOff = processRef as ChildProcess & { off?: (event: string, listener: ProcessEventHandler) => ChildProcess };
        if (typeof withOff.off === 'function') {
          withOff.off(event, handler);
          return;
        }
        const withRemove = processRef as ChildProcess & { removeListener?: (event: string, listener: ProcessEventHandler) => ChildProcess };
        if (typeof withRemove.removeListener === 'function') {
          withRemove.removeListener(event, handler);
        }
      };

      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        removeListener('close', onCloseDuringStartup);
        removeListener('error', onErrorDuringStartup);
        fn();
      };

      const onCloseDuringStartup = (code: number | null, signal: NodeJS.Signals | null) => {
        finish(() => {
          reject(
            new Error(
              `Xray exited during startup (code=${code ?? 'null'}, signal=${signal ?? 'none'})`
            )
          );
        });
      };

      const onErrorDuringStartup = (error: Error) => {
        finish(() => reject(error));
      };

      const closeListenerAttached = addListener('close', onCloseDuringStartup);
      const errorListenerAttached = addListener('error', onErrorDuringStartup);
      if (!closeListenerAttached && !errorListenerAttached) {
        resolve();
        return;
      }
      timeoutId = setTimeout(() => finish(resolve), XrayService.STARTUP_GRACE_MS);
    });
  }
}

export const xrayService = new XrayService();
