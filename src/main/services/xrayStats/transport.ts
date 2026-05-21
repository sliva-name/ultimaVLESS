export interface XrayStat {
  name: string;
  value: number;
}

export interface XrayStatsTransport {
  queryStats(pattern: string, timeoutMs: number): Promise<XrayStat[]>;
  close(): void;
}
