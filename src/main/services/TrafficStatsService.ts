import { EventEmitter } from 'events';
import { APP_CONSTANTS } from '@/shared/constants';
import { PerfTimer } from '@/shared/perfMetrics';
import { logger } from './LoggerService';
import { XrayStatsClient } from './XrayStatsClient';

export interface TrafficSnapshot {
  uploadBytes: number;
  downloadBytes: number;
  uploadBps: number;
  downloadBps: number;
  sessionDurationMs: number;
  connectedAt: number;
  sampledAt: number;
}

interface RawCounters {
  uploadBytes: number;
  downloadBytes: number;
}

const POLL_INTERVAL_MS = 1000;
const QUERY_TIMEOUT_MS = 900;
/** When traffic is idle, throttle IPC snapshots to the renderer. */
const IDLE_EMIT_INTERVAL_MS = 2000;

/**
 * Polls Xray's gRPC StatsService and emits `snapshot` events with cumulative
 * + instantaneous traffic counters for the active outbound tagged `proxy`.
 */
export class TrafficStatsService extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private connectedAt = 0;
  private lastSnapshot: TrafficSnapshot | null = null;
  private lastEmittedSnapshot: TrafficSnapshot | null = null;
  private lastRaw: RawCounters | null = null;
  private lastRawAt = 0;
  private inFlight = false;
  private lastLoggedFailure = 0;
  private statsClient: XrayStatsClient | null = null;

  public start(connectedAt = Date.now()): void {
    this.stop();
    this.connectedAt = connectedAt;
    this.lastSnapshot = null;
    this.lastEmittedSnapshot = null;
    this.lastRaw = null;
    this.lastRawAt = 0;
    this.timer = setInterval(() => {
      void this.tick();
    }, POLL_INTERVAL_MS);
    const initial: TrafficSnapshot = {
      uploadBytes: 0,
      downloadBytes: 0,
      uploadBps: 0,
      downloadBps: 0,
      sessionDurationMs: 0,
      connectedAt,
      sampledAt: Date.now(),
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
    this.statsClient?.close();
    this.statsClient = null;
    this.emit('stopped');
  }

  public getLastSnapshot(): TrafficSnapshot | null {
    return this.lastSnapshot;
  }

  private emitSnapshot(snapshot: TrafficSnapshot): void {
    if (!this.shouldEmitToRenderer(snapshot)) {
      return;
    }
    this.lastEmittedSnapshot = snapshot;
    this.emit('snapshot', snapshot);
  }

  private shouldEmitToRenderer(snapshot: TrafficSnapshot): boolean {
    const previous = this.lastEmittedSnapshot;
    if (!previous) {
      return true;
    }
    if (
      snapshot.uploadBytes !== previous.uploadBytes ||
      snapshot.downloadBytes !== previous.downloadBytes
    ) {
      return true;
    }
    if (snapshot.uploadBps > 0 || snapshot.downloadBps > 0) {
      return true;
    }
    return snapshot.sampledAt - previous.sampledAt >= IDLE_EMIT_INTERVAL_MS;
  }

  private async tick(): Promise<void> {
    if (this.inFlight || this.connectedAt === 0) return;
    this.inFlight = true;
    const timer = new PerfTimer('TrafficStatsService', 'tick');
    try {
      const raw = await this.queryCounters();
      if (this.connectedAt === 0) return;
      const now = Date.now();
      if (!raw) {
        return;
      }

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
      timer.end();
      this.inFlight = false;
    }
  }

  private async queryCounters(): Promise<RawCounters | null> {
    const server = `127.0.0.1:${APP_CONSTANTS.PORTS.API}`;

    try {
      const statList = await this.getStatsClient(server).queryStats(
        'outbound>>>proxy',
        QUERY_TIMEOUT_MS,
      );
      let upload = 0;
      let download = 0;
      for (const entry of statList) {
        if (!entry || typeof entry.name !== 'string') continue;
        const numeric = Number(entry.value ?? 0);
        if (!Number.isFinite(numeric)) continue;
        if (entry.name.endsWith('uplink')) upload += numeric;
        else if (entry.name.endsWith('downlink')) download += numeric;
      }
      return { uploadBytes: upload, downloadBytes: download };
    } catch (error) {
      const now = Date.now();
      if (now - this.lastLoggedFailure > 30_000) {
        this.lastLoggedFailure = now;
        logger.debug('TrafficStatsService', 'Stats query failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return null;
    }
  }

  private getStatsClient(server: string): XrayStatsClient {
    if (!this.statsClient) {
      this.statsClient = new XrayStatsClient(server);
    }
    return this.statsClient;
  }
}

export const trafficStatsService = new TrafficStatsService();
