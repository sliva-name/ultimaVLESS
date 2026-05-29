export type UpdateStage =
  | 'idle'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'disabled';

export interface UpdateStatus {
  stage: UpdateStage;
  version: string | null;
  releaseNotes: string | null;
  /** Download progress in percent (0-100). Only meaningful while downloading. */
  percent: number;
  /** Bytes/sec of download progress. Only meaningful while downloading. */
  bytesPerSecond: number;
  error: string | null;
  /** Epoch ms when this status was produced. */
  updatedAt: number;
}
