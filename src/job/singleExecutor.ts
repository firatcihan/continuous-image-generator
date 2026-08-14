/**
 * Lets only one of N workers do a piece of work; late arrivals join the run
 * already in progress.
 *
 * Parallel generation needs this in three places. Without it, 3 workers would
 * enter 3 separate 15-minute rate-limit sleeps serializing into 45 minutes,
 * pop 3 separate "log in" cards, and restart the browser 3 times.
 */
export class SingleExecutor {
  private running: Promise<void> | null = null;

  run(work: () => Promise<void>): Promise<void> {
    if (this.running !== null) return this.running;

    // Cleanup via `finally`: if the problem STILL exists after the running
    // work finishes, the next worker's own detection must be able to start a
    // fresh run.
    this.running = work().finally(() => {
      this.running = null;
    });
    return this.running;
  }
}
