import fs from 'fs';
import { logger } from '@/main/services/LoggerService';

export class XrayLogCursor {
  private offset = 0;
  private partialLine = '';

  constructor(private readonly logPath: string) {}

  public async readNewLines(count: number): Promise<string[]> {
    try {
      try {
        await fs.promises.access(this.logPath, fs.constants.F_OK);
      } catch {
        return [];
      }

      const stats = await fs.promises.stat(this.logPath);
      if (stats.size === 0) {
        return [];
      }

      const maxChunkBytes = 128 * 1024;
      if (stats.size < this.offset) {
        this.offset = 0;
        this.partialLine = '';
      }

      const previousOffset = this.offset;
      const unreadLength = stats.size - previousOffset;
      if (unreadLength <= 0) {
        return [];
      }

      const readStart =
        unreadLength > maxChunkBytes
          ? stats.size - maxChunkBytes
          : previousOffset;
      const readLength = stats.size - readStart;
      const buffer = Buffer.alloc(readLength);
      const fd = await fs.promises.open(this.logPath, 'r');
      try {
        await fd.read(buffer, 0, readLength, readStart);
      } finally {
        await fd.close();
      }

      const content = buffer.toString('utf-8');
      const combined = `${readStart === previousOffset ? this.partialLine : ''}${content}`;
      this.offset = stats.size;
      const chunks = combined.split('\n');
      this.partialLine = chunks.pop() ?? '';
      const lines = chunks
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      return lines.slice(-count);
    } catch (error) {
      logger.error('ConnectionMonitorService', 'Failed to read log file', error);
      return [];
    }
  }

  /**
   * Synchronous on purpose: must complete before the first health-check tick
   * and before callers append to xray.log for the new session.
   */
  public resetToEnd(): void {
    try {
      if (!fs.existsSync(this.logPath)) {
        this.offset = 0;
        this.partialLine = '';
        return;
      }
      const stats = fs.statSync(this.logPath);
      this.offset = stats.size;
      this.partialLine = '';
    } catch (error) {
      logger.warn('ConnectionMonitorService', 'Failed to reset log cursor', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.offset = 0;
      this.partialLine = '';
    }
  }
}
