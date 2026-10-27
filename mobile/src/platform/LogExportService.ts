import { app } from '../electron';
import { logger } from './LoggerService';
import { connectionManager } from '@/main/domain/connection/ConnectionManager';
import { connectionMonitorService } from '@/main/services/ConnectionMonitorService';
import { xrayService } from '@/main/services/XrayService';
import { appRecoveryService } from '@/main/services/AppRecoveryService';
import {
  sanitizeDiagnosticPayload,
  sanitizeSensitiveText,
} from '@/shared/sanitizeDiagnostics';
import {
  activeServerIdFromState,
  lastErrorFromState,
} from '@/main/domain/connection/ConnectionState';
import { getServerRepository } from '@/main/infrastructure/persistence/ElectronServerRepository';
import { toSafeServer } from '@/shared/serverView';
import { UltimaCore } from '../native/UltimaCore';

const MAX_LOG_BYTES = 50 * 1024;

/**
 * Same diagnostic bundle as desktop. "Open log folder" becomes the share
 * sheet: Android apps cannot show their private directory.
 */
export class LogExportService {
  public async getExportableLogs(): Promise<string> {
    await logger.flush();
    const info = await UltimaCore.getAppInfo();

    let content = '=== SYSTEM INFO ===\n';
    content += `Platform: android (SDK ${info.sdkInt})\n`;
    content += `Arch: ${info.abi}\n`;
    content += `App Version: ${app.getVersion()}\n`;
    content += `Core: ${info.coreVersion}\n`;
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
    content += await this.readTail('app');
    content += '\n\n=== XRAY LOGS ===\n';
    content += await this.readTail('xray');
    return sanitizeSensitiveText(content);
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
      const text = await this.getExportableLogs();
      await UltimaCore.shareText({
        title: 'UltimaVLESS logs',
        text,
        fileName: `ultimavless-logs-${new Date().toISOString().slice(0, 10)}.txt`,
      });
    } catch (e) {
      logger.error('LogExportService', 'Failed to share logs', e);
    }
  }

  private async readTail(name: string): Promise<string> {
    try {
      const { size } = await UltimaCore.logSize({ name });
      if (size === 0) return '[Log file not found]';
      const start = Math.max(0, size - MAX_LOG_BYTES);
      const { text } = await UltimaCore.readLog({
        name,
        offset: start,
        maxBytes: size - start,
      });
      return start > 0 ? `...[truncated]...\n${text}` : text;
    } catch (e) {
      return `[Error reading log: ${String(e)}]`;
    }
  }
}

export const logExportService = new LogExportService();
