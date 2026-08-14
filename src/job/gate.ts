/** Pause gate. While closed, pass() blocks; open() releases all waiters. */
export class Gate {
  private closed = false;
  private waiters: Array<() => void> = [];

  isOpen(): boolean {
    return !this.closed;
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.closed = false;
    const toResolve = this.waiters;
    this.waiters = [];
    for (const resolve of toResolve) resolve();
  }

  pass(): Promise<void> {
    if (!this.closed) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

/**
 * Coordination gates a worker passes at the top of its loop.
 *
 * All three are the gate half of the "first to see it acts, the rest wait"
 * principle: while one worker handles the problem the others finish their
 * IN-FLIGHT row but cannot pull a NEW one. The other half is `SingleExecutor`
 * (see src/job/singleExecutor.ts).
 */
export interface JobGates {
  limit: Gate;
  user: Gate;
  restart: Gate;
}
