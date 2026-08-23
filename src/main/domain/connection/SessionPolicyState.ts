/**
 * Session-owned policy ledger: auto-switch toggle and blocked servers.
 * Probe failures are facts; this object decides what the session remembers.
 */
export class SessionPolicyState {
  private readonly blockedServerIds = new Set<string>();
  private readonly blockedAt = new Map<string, number>();
  private autoSwitchingEnabled = true;
  private static readonly COOLDOWN_MS = 10 * 60 * 1000;

  public getAutoSwitchingEnabled(): boolean {
    return this.autoSwitchingEnabled;
  }

  public setAutoSwitchingEnabled(enabled: boolean): void {
    this.autoSwitchingEnabled = enabled;
  }

  public getBlockedServerIds(now: number = Date.now()): string[] {
    this.pruneExpired(now);
    return [...this.blockedServerIds];
  }

  public markBlocked(serverId: string, now: number = Date.now()): void {
    this.blockedAt.set(serverId, now);
    this.blockedServerIds.add(serverId);
  }

  public clearBlocked(): void {
    this.blockedServerIds.clear();
    this.blockedAt.clear();
  }

  public pruneExpired(now: number = Date.now()): void {
    for (const serverId of [...this.blockedServerIds]) {
      const failedAt = this.blockedAt.get(serverId);
      if (
        failedAt == null ||
        now - failedAt >= SessionPolicyState.COOLDOWN_MS
      ) {
        this.blockedServerIds.delete(serverId);
        this.blockedAt.delete(serverId);
      }
    }
  }
}
