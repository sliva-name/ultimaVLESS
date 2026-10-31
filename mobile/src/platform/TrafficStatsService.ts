import { EventEmitter } from '../node/events';
import type { TrafficSnapshot } from '@/shared/views/traffic';
import { logger } from './LoggerService';
import { UltimaCore } from '../native/UltimaCore';
import { xrayService } from './XrayService';

export type { TrafficSnapshot };

const POLL_INTERVAL_MS = 1000;
/** When traffic is idle, throttle snapshots to the renderer. */
const IDLE_EMIT_INTERVAL_MS = 2000;

/**
 * Desktop polls Xray's gRPC StatsService; on Android the core runs in-process
 * and the plugin reads the `proxy` outbound counters directly. Snapshots and
 * their throttling match the desktop service.
 *
 * The session clock follows the native session: one that outlived an earlier
 * WebView keeps counting from when it really started.
 */
export class TrafficStatsService extends EventEmitter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private connectedAt = 0;
  private lastSnapshot: TrafficSnapshot | null = null;
  private lastEmittedSnapshot: TrafficSnapshot | null = null;
  private lastRaw: { uploadBytes: number; downloadBytes: number } | null = null;
  private lastRawAt = 0;
  private inFlight = false;
  private lastLoggedFailure = 0;

  public start(connectedAt = Date.now()): void {
    this.stop();
    this.connectedAt = xrayService.getAdoptedStartedAt() ?? connectedAt;
    this.timer = setInterval(() => {
      void this.tick();
    }, POLL_INTERVAL_MS);
    const now = Date.now();
    const initial: TrafficSnapshot = {
      uploadBytes: 0,
      downloadBytes: 0,
      uploadBps: 0,
      downloadBps: 0,
      sessionDurationMs: Math.max(0, now - this.connectedAt),
      connectedAt: this.connectedAt,
      sampledAt: now,
    };
    this.lastSnapshot = initial;
    this.emitSnapshot(initial);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.connectedAt = 0;
    this.lastSnapshot = null;
    this.lastEmittedSnapshot = null;
    this.lastRaw = null;
    this.lastRawAt = 0;
    this.emit('stopped');
  }

  public getLastSnapshot(): TrafficSnapshot | null {
    return this.lastSnapshot;
  }

  private emitSnapshot(snapshot: TrafficSnapshot): void {
    const previous = this.lastEmittedSnapshot;
    const changed =
      !previous ||
      snapshot.uploadBytes !== previous.uploadBytes ||
      snapshot.downloadBytes !== previous.downloadBytes ||
      snapshot.uploadBps > 0 ||
      snapshot.downloadBps > 0 ||
      snapshot.sampledAt - previous.sampledAt >= IDLE_EMIT_INTERVAL_MS;
    if (!changed) return;
    this.lastEmittedSnapshot = snapshot;
    this.emit('snapshot', snapshot);
  }

  private async tick(): Promise<void> {
    if (this.inFlight || this.connectedAt === 0) return;
    this.inFlight = true;
    try {
      let raw: { uploadBytes: number; downloadBytes: number };
      try {
        const { uplink, downlink } = await UltimaCore.getTraffic();
        raw = { uploadBytes: uplink, downloadBytes: downlink };
      } catch (error) {
        const now = Date.now();
        if (now - this.lastLoggedFailure > 30_000) {
          this.lastLoggedFailure = now;
          logger.debug('TrafficStatsService', 'Stats query failed', {
            message: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      if (this.connectedAt === 0) return;
      const now = Date.now();
      let uploadBps = 0;
      let downloadBps = 0;
      if (this.lastRaw && this.lastRawAt > 0) {
        const dtSec = Math.max(0.001, (now - this.lastRawAt) / 1000);
        uploadBps = Math.max(
          0,
          (raw.uploadBytes - this.lastRaw.uploadBytes) / dtSec,
        );
        downloadBps = Math.max(
          0,
          (raw.downloadBytes - this.lastRaw.downloadBytes) / dtSec,
        );
      }
      this.lastRaw = raw;
      this.lastRawAt = now;
      const snapshot: TrafficSnapshot = {
        uploadBytes: raw.uploadBytes,
        downloadBytes: raw.downloadBytes,
        uploadBps,
        downloadBps,
        sessionDurationMs: Math.max(0, now - this.connectedAt),
        connectedAt: this.connectedAt,
        sampledAt: now,
      };
      this.lastSnapshot = snapshot;
      this.emitSnapshot(snapshot);
    } finally {
      this.inFlight = false;
    }
  }
}

export const trafficStatsService = new TrafficStatsService();
