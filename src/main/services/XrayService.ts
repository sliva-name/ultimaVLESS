import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { ConnectionMode, VlessConfig } from '../../shared/types';
import { ConfigGenerator } from './ConfigGenerator';
import { logger } from './LoggerService';

/**
 * Service responsible for managing the Xray-core process.
 * Handles configuration generation, process spawning, and lifecycle management.
 */
export class XrayService {
  private process: ChildProcess | null = null;
  private resourcesPath: string;

  constructor() {
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
  public async start(config: VlessConfig, connectionMode: ConnectionMode = 'proxy'): Promise<void> {
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
    });
    
    const xrayConfig = ConfigGenerator.generate(config, logPath, connectionMode);
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

    try {
      this.process = spawn(binPath, ['-c', configPath], {
        env: {
          ...process.env,
          'XRAY_LOCATION_ASSET': this.resourcesPath
        }
      });
      logger.info('XrayService', 'Process spawned', { pid: this.process.pid });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      logger.error('XrayService', 'Spawn failed', error);
      throw error;
    }

    this.process.stdout?.on('data', (data) => {
      const output = data.toString();
      // Логируем важные сообщения из stdout
      if (output.includes('error') || output.includes('failed') || output.includes('blocked')) {
        logger.error('XrayService', 'STDOUT error detected', { data: output.trim() });
      }
    });

    this.process.stderr?.on('data', (data) => {
      const errorOutput = data.toString();
      logger.error('XrayService', 'STDERR', { 
        data: errorOutput.trim(),
        server: config.name,
        serverAddress: `${config.address}:${config.port}`,
      });
    });

    this.process.on('close', (code) => {
      logger.warn('XrayService', 'Process exited', { 
        code,
        server: config.name,
        serverAddress: `${config.address}:${config.port}`,
        exitCode: code,
      });
      this.process = null;
    });
    
    this.process.on('error', (err) => {
        logger.error('XrayService', 'Process error', {
          error: err.message,
          stack: err.stack,
          server: config.name,
          serverAddress: `${config.address}:${config.port}`,
        });
    });
  }

  /**
   * Stops the running Xray process if one exists.
   */
  public stop(): void {
    if (this.process) {
      logger.info('XrayService', 'Stopping process...');
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
}

export const xrayService = new XrayService();
