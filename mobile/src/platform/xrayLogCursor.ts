import { logger } from './LoggerService';
import { UltimaCore } from '../native/UltimaCore';

const MAX_CHUNK_BYTES = 128 * 1024;

/**
 * Tails Xray's error log for the connection monitor, like the desktop cursor,
 * with the file read natively. `resetToFileEnd` is synchronous for its
 * callers, so it records the end-of-file position as a pending lookup that
 * the next read waits for.
 */
export class XrayLogCursor {
  private readOffset: Promise<number> = Promise.resolve(0);
  private partialLine = '';

  constructor(private readonly logPath: string) {}

  private get logName(): string {
    return (this.logPath.split('/').pop() ?? 'xray.log').replace(/\.log$/, '');
  }

  public resetToFileEnd(): void {
    this.partialLine = '';
    this.readOffset = UltimaCore.logSize({ name: this.logName })
      .then(({ size }) => size)
      .catch((error: unknown) => {
        logger.warn('ConnectionMonitorService', 'Failed to reset log cursor', {
          error: error instanceof Error ? error.message : String(error),
        });
        return 0;
      });
  }

  public async readNewLines(count: number): Promise<string[]> {
    try {
      const previousOffset = await this.readOffset;
      const { size } = await UltimaCore.logSize({ name: this.logName });
      let offset = previousOffset;
      if (size < offset) {
        offset = 0;
        this.partialLine = '';
      }
      if (size <= offset) {
        this.readOffset = Promise.resolve(size);
        return [];
      }
      const readStart =
        size - offset > MAX_CHUNK_BYTES ? size - MAX_CHUNK_BYTES : offset;
      const { text } = await UltimaCore.readLog({
        name: this.logName,
        offset: readStart,
        maxBytes: size - readStart,
      });
      const combined = `${readStart === offset ? this.partialLine : ''}${text}`;
      this.readOffset = Promise.resolve(size);
      const chunks = combined.split('\n');
      this.partialLine = chunks.pop() ?? '';
      return chunks
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(-count);
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
