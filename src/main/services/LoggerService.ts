import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { rotateFileSync } from '@/main/utils/logRotation';

/**
 * Service for file-based logging.
 * Writes logs to the application's dedicated log directory to ensure write permissions.
 *
 * Entries are buffered in memory until {@link beginSession} (or {@link flush})
 * decides how this process relates to the log file: the primary instance
 * rotates the previous session out first, while a duplicate launch that only
 * hands over activation appends to the running instance's file without
 * touching its history.
 */
export class LoggerService {
  private static readonly MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024;
  private static readonly MAX_LOG_BACKUPS = 3;
  /** Check log file size every N append operations instead of every write. */
  private static readonly ROTATE_CHECK_EVERY_WRITES = 50;
  /** Import-time logging is small; this only guards a process that never commits. */
  private static readonly MAX_BUFFERED_ENTRIES = 2000;
  private logPath: string;
  private readonly debugEnabled: boolean;
  private writeQueue: Promise<void> = Promise.resolve();
  private writesSinceRotateCheck = 0;
  private sessionCommitted = false;
  private bufferedEntries: string[] = [];

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

    this.logPath = path.join(logDir, filename);
    this.debugEnabled =
      process.env.NODE_ENV === 'development' ||
      process.env.ULTIMA_DEBUG === '1';
    this.ensureLogDirExists();
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
   * @param {unknown} [data] - Optional data to serialize.
   */
  public log(location: string, message: string, data?: unknown): void {
    const logEntry =
      JSON.stringify({
        timestamp: new Date().toISOString(),
        location,
        message,
        data,
      }) + '\n';

    if (!this.sessionCommitted) {
      if (this.bufferedEntries.length >= LoggerService.MAX_BUFFERED_ENTRIES) {
        this.bufferedEntries.shift();
      }
      this.bufferedEntries.push(logEntry);
      return;
    }
    this.enqueueWrite(logEntry);
  }

  private enqueueWrite(logEntry: string): void {
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        this.ensureLogDirExists();
        this.maybeRotate();
        if (typeof fs.appendFile === 'function') {
          await new Promise<void>((resolve, reject) => {
            fs.appendFile(this.logPath, logEntry, (error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
          });
          return;
        }
        fs.appendFileSync(this.logPath, logEntry);
      } catch (e) {
        console.error('Failed to write to log file', e);
      }
    });
  }

  /**
   * Commits buffered entries and waits for every pending write. A process that
   * never called {@link beginSession} (a duplicate launch exiting after the
   * activation hand-over) appends to the current file without rotating it.
   */
  public flush(): Promise<void> {
    this.commitSession(false);
    return this.writeQueue;
  }

  /**
   * Declares this process the owner of a new log session: the previous
   * session's file is kept as `app.log.1` (older ones shift down) and this
   * session starts on a fresh file, buffered import-time entries first.
   *
   * Replaces the old "truncate on shutdown" step, which destroyed exactly the
   * log needed for a post-mortem — and, during an elevated relaunch, wiped the
   * file the replacement process was already writing to.
   */
  public beginSession(): void {
    this.commitSession(true);
  }

  private commitSession(rotate: boolean): void {
    if (this.sessionCommitted) {
      return;
    }
    this.sessionCommitted = true;
    if (rotate) {
      try {
        this.ensureLogDirExists();
        rotateFileSync(this.logPath, LoggerService.MAX_LOG_BACKUPS);
      } catch (e) {
        console.error('Failed to rotate log file for the new session', e);
      }
    }
    const pending = this.bufferedEntries;
    this.bufferedEntries = [];
    if (pending.length > 0) {
      this.enqueueWrite(pending.join(''));
    }
  }

  private maybeRotate(): void {
    this.writesSinceRotateCheck += 1;
    if (this.writesSinceRotateCheck < LoggerService.ROTATE_CHECK_EVERY_WRITES) {
      return;
    }
    this.writesSinceRotateCheck = 0;
    this.rotateIfNeeded();
  }

  private rotateIfNeeded(): void {
    if (!fs.existsSync(this.logPath)) {
      return;
    }

    const stats = fs.statSync(this.logPath);
    if (stats.size < LoggerService.MAX_LOG_SIZE_BYTES) {
      return;
    }

    rotateFileSync(this.logPath, LoggerService.MAX_LOG_BACKUPS);
  }

  private ensureLogDirExists(): void {
    const logDir = path.dirname(this.logPath);
    if (fs.existsSync(logDir)) {
      return;
    }
    try {
      fs.mkdirSync(logDir, { recursive: true });
    } catch (e) {
      console.error('Failed to create log directory', e);
    }
  }

  /**
   * Logs an informational message.
   * @param {string} location - The source location.
   * @param {string} message - The info message.
   * @param {unknown} [data] - Optional context data.
   */
  public info(location: string, message: string, data?: unknown): void {
    this.log(location, `[INFO] ${message}`, data);
  }

  /**
   * Logs a warning message.
   * @param {string} location - The source location.
   * @param {string} message - The warning message.
   * @param {unknown} [data] - Optional context data.
   */
  public warn(location: string, message: string, data?: unknown): void {
    this.log(location, `[WARN] ${message}`, data);
  }

  /**
   * Logs an error message.
   * @param {string} location - The source location.
   * @param {string} message - The error description.
   * @param {unknown} [error] - The error object or data.
   */
  public error(location: string, message: string, error?: unknown): void {
    this.log(
      location,
      `[ERROR] ${message}`,
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : error,
    );
  }

  /**
   * Logs a debug message.
   * @param {string} location - The source location.
   * @param {string} message - The debug message.
   * @param {unknown} [data] - Optional context data.
   */
  public debug(location: string, message: string, data?: unknown): void {
    if (!this.debugEnabled) {
      return;
    }
    this.log(location, `[DEBUG] ${message}`, data);
  }
}

export const logger = new LoggerService('app.log');
