import fs from 'fs';
import path from 'path';
import { app, shell } from 'electron';
import { logger } from './LoggerService';
import { connectionManager } from '@/main/domain/connection/ConnectionManager';
import { connectionMonitorService } from './ConnectionMonitorService';
import { xrayService } from './XrayService';
import { appRecoveryService } from './AppRecoveryService';
import {
  sanitizeDiagnosticPayload,
  sanitizeSensitiveText,
} from '@/shared/sanitizeDiagnostics';
import {
  lastErrorFromState,
  activeServerIdFromState,
} from '@/main/domain/connection/ConnectionState';
import { getServerRepository } from '@/main/infrastructure/persistence/ElectronServerRepository';
import { toSafeServer } from '@/shared/serverView';

export class LogExportService {
  /**
   * Reads app and Xray logs, combines them, and sanitizes sensitive info.
   * @returns {Promise<string>} Combined log content.
   */
  public async getExportableLogs(): Promise<string> {
    const appLogPath = logger.getLogPath();
    const userDataPath = app.getPath('userData');
    const xrayLogPath = path.join(userDataPath, 'xray.log');

    let content = '=== SYSTEM INFO ===\n';
    content += `Platform: ${process.platform}\n`;
    content += `Arch: ${process.arch}\n`;
    content += `App Version: ${app.getVersion()}\n`;
    content += `Date: ${new Date().toISOString()}\n\n`;
    content += '=== HEALTH SUMMARY ===\n';
    content += `${JSON.stringify(
      sanitizeDiagnosticPayload({
        session: this.summarizeSession(),
        health: connectionMonitorService.getStatus(),
        xray: xrayService.getHealthStatus(),
        recovery: appRecoveryService.getStatus(),
      }),
      null,
      2,
    )}\n\n`;

    content += '=== APP LOGS ===\n';
    content += await this.safeReadFile(appLogPath);

    content += '\n\n=== XRAY LOGS ===\n';
    content += await this.safeReadFile(xrayLogPath);

    return this.sanitize(content);
  }

  private summarizeSession(): Record<string, unknown> {
    const state = connectionManager.getConnectionState();
    const activeServerId = activeServerIdFromState(state);
    const server = activeServerId
      ? getServerRepository().get(activeServerId)
      : undefined;
    return {
      phase: connectionManager.getPhase(),
      lastError: lastErrorFromState(state),
      activeServerId,
      blockedServerIds: connectionManager.getBlockedServerIds(),
      currentServer: server ? toSafeServer(server) : null,
    };
  }

  public async openLogFolder(): Promise<void> {
    try {
      const logDir = path.dirname(logger.getLogPath());
      await shell.openPath(logDir);
    } catch (e) {
      logger.error('LogExportService', 'Failed to open log folder', e);
    }
  }

  private async safeReadFile(filePath: string): Promise<string> {
    try {
      try {
        await fs.promises.access(filePath, fs.constants.F_OK);
      } catch {
        return '[Log file not found]';
      }

      const stats = await fs.promises.stat(filePath);
      const maxSize = 50 * 1024;

      if (stats.size > maxSize) {
        const buffer = Buffer.alloc(maxSize);
        const fd = await fs.promises.open(filePath, 'r');
        try {
          await fd.read(buffer, 0, maxSize, stats.size - maxSize);
        } finally {
          await fd.close();
        }
        return '...[truncated]...\n' + buffer.toString('utf-8');
      }

      return await fs.promises.readFile(filePath, 'utf-8');
    } catch (e) {
      return `[Error reading log: ${e}]`;
    }
  }

  private sanitize(text: string): string {
    return sanitizeSensitiveText(text);
  }
}

export const logExportService = new LogExportService();
