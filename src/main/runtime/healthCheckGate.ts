/**
 * At most one probe runs. A request while busy becomes a single rerun
 * after the current probe finishes — no busy-wait, no stacked waiters.
 */
export class HealthCheckGate {
  private inFlight = false;
  private rerun = false;
  private generation = 0;

  public request(run: () => Promise<void>): void {
    if (this.inFlight) {
      this.rerun = true;
      return;
    }
    void this.execute(run);
  }

  public reset(): void {
    this.generation += 1;
    this.inFlight = false;
    this.rerun = false;
  }

  public get isInFlight(): boolean {
    return this.inFlight;
  }

  private async execute(run: () => Promise<void>): Promise<void> {
    const generation = this.generation;
    this.inFlight = true;
    try {
      await run();
    } finally {
      if (this.generation === generation) {
        this.inFlight = false;
        if (this.rerun) {
          this.rerun = false;
          void this.execute(run);
        }
      }
    }
  }
}
