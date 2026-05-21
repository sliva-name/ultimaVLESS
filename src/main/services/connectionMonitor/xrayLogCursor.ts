import fs from 'fs';
import { logger } from '../LoggerService';

export class XrayLogCursor {
  private readOffset = 0;
  private partialLine = '';

  constructor(private readonly logPath: string) {}

  public resetToFileEnd(): void {
    try {
      if (!fs.existsSync(this.logPath)) {
        this.readOffset = 0;
        this.partialLine = '';
        return;
      }
      const stats = fs.statSync(this.logPath);
      this.readOffset = stats.size;
      this.partialLine = '';
    } catch (error) {
      logger.warn('ConnectionMonitorService', 'Failed to reset log cursor', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.readOffset = 0;
      this.partialLine = '';
    }
  }

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
      if (stats.size < this.readOffset) {
        this.readOffset = 0;
        this.partialLine = '';
      }

      const previousOffset = this.readOffset;
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
      this.readOffset = stats.size;
      const chunks = combined.split('\n');
      this.partialLine = chunks.pop() ?? '';
      const lines = chunks
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      return lines.slice(-count);
    } catch (error) {
      logger.error(
        'ConnectionMonitorService',
        'Failed to read log file',
        error,
      );
      return [];
    }
  }
}
