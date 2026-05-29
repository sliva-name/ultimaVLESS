export interface TrafficSnapshot {
  uploadBytes: number;
  downloadBytes: number;
  uploadBps: number;
  downloadBps: number;
  sessionDurationMs: number;
  connectedAt: number;
  sampledAt: number;
}
