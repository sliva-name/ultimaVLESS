/**
 * Startup recovery of orphaned network state (system proxy left on by a
 * killed session, TUN routes of a crashed one) runs in the background after the
 * first window is up. Anything that mutates the network stack must wait for it:
 * recovery deleting a proxy host route while a connect is pinning the same
 * prefix would silently break the tunnel.
 *
 * The gate is a memoised promise. Before recovery has been started it resolves
 * immediately (nothing to wait for), and it never rejects — a failed recovery is
 * logged by its owner and must not block connecting.
 */
export interface NetworkRecoveryGate {
  awaitNetworkRecovery(): Promise<void>;
}

export class StartupRecoveryCoordinator implements NetworkRecoveryGate {
  private recovery: Promise<void> | null = null;

  /**
   * Runs `work` once. Later calls return the same promise, so `main.ts` can
   * kick recovery off exactly once while others just await the outcome.
   */
  public run(work: () => Promise<void>): Promise<void> {
    this.recovery ??= work().catch(() => undefined);
    return this.recovery;
  }

  public awaitNetworkRecovery(): Promise<void> {
    return this.recovery ?? Promise.resolve();
  }

  public get isRunning(): boolean {
    return this.recovery !== null;
  }
}

export const startupRecovery = new StartupRecoveryCoordinator();
