import fs from 'fs';
import path from 'path';
import { app, shell } from 'electron';
import { logger } from './LoggerService';

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

    content += '=== APP LOGS ===\n';
    content += await this.safeReadFile(appLogPath);
    
    content += '\n\n=== XRAY LOGS ===\n';
    content += await this.safeReadFile(xrayLogPath);

    return this.sanitize(content);
  }

  /**
   * Opens the folder containing the logs in the OS file explorer.
   */
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
      if (fs.existsSync(filePath)) {
        // Read last 50KB to avoid huge files
        const stats = fs.statSync(filePath);
        const maxSize = 50 * 1024; 
        
        if (stats.size > maxSize) {
            const buffer = Buffer.alloc(maxSize);
            const fd = fs.openSync(filePath, 'r');
            fs.readSync(fd, buffer, 0, maxSize, stats.size - maxSize);
            fs.closeSync(fd);
            return '...[truncated]...\n' + buffer.toString('utf-8');
        }
        
        return fs.readFileSync(filePath, 'utf-8');
      }
      return '[Log file not found]';
    } catch (e) {
      return `[Error reading log: ${e}]`;
    }
  }

  /**
   * Removes sensitive data like UUIDs and IPs.
   */
  private sanitize(text: string): string {
    return text
      // UUID regex (approximate)
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '***-UUID-***')
      // IP Address regex (v4) - simple check to avoid masking localhost
      .replace(/\b(?<!127\.0\.0\.1)(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g, '***.***.***.***')
      // Private keys usually are long base64 strings, hard to detect perfectly without context, 
      // but ConfigGenerator doesn't log them.
      ;
  }
}

export const logExportService = new LogExportService();

