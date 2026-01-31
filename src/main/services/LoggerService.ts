import fs from 'fs';
import path from 'path';
import { app } from 'electron';

/**
 * Service for file-based logging.
 * Writes logs to the application's dedicated log directory to ensure write permissions.
 */
export class LoggerService {
  private logPath: string;

  /**
   * @param {string} filename - The log file name (default: 'app.log').
   */
  constructor(filename: string = 'app.log') {
    // Use app.getPath('logs') if available (Electron), otherwise fallback to userData or cwd (testing)
    let logDir: string;
    try {
        logDir = app.getPath('logs');
    } catch {
        // Fallback for testing environments where app is not available
        logDir = path.join(process.cwd(), 'logs');
    }

    if (!fs.existsSync(logDir)) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
      } catch (e) {
        console.error('Failed to create log directory', e);
      }
    }
    
    this.logPath = path.join(logDir, filename);
  }

  /**
   * Returns the full path to the current log file.
   */
  public getLogPath(): string {
    return this.logPath;
  }

  /**
   * Writes a raw log entry.
   * @param {string} location - The source file or module name.
   * @param {string} message - The log message.
   * @param {any} [data] - Optional data to serialize.
   */
  public log(location: string, message: string, data?: any): void {
    try {
      const logEntry = JSON.stringify({
        timestamp: new Date().toISOString(),
        location,
        message,
        data,
      }) + '\n';
      fs.appendFileSync(this.logPath, logEntry);
    } catch (e) {
      console.error('Failed to write to log file', e);
    }
  }

  /**
   * Logs an informational message.
   * @param {string} location - The source location.
   * @param {string} message - The info message.
   * @param {any} [data] - Optional context data.
   */
  public info(location: string, message: string, data?: any): void {
    this.log(location, `[INFO] ${message}`, data);
  }

  /**
   * Logs a warning message.
   * @param {string} location - The source location.
   * @param {string} message - The warning message.
   * @param {any} [data] - Optional context data.
   */
  public warn(location: string, message: string, data?: any): void {
    this.log(location, `[WARN] ${message}`, data);
  }

  /**
   * Logs an error message.
   * @param {string} location - The source location.
   * @param {string} message - The error description.
   * @param {any} [error] - The error object or data.
   */
  public error(location: string, message: string, error?: any): void {
    this.log(location, `[ERROR] ${message}`, error instanceof Error ? { message: error.message, stack: error.stack } : error);
  }

  /**
   * Logs a debug message.
   * @param {string} location - The source location.
   * @param {string} message - The debug message.
   * @param {any} [data] - Optional context data.
   */
  public debug(location: string, message: string, data?: any): void {
    this.log(location, `[DEBUG] ${message}`, data);
  }
}

export const logger = new LoggerService('app.log');
