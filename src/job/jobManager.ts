import type { Logger } from '../logger.js';
import type { Config, RunSummary, Row, GenerationTab } from '../types.js';
import { processAllRows, type SleepReason } from '../worker.js';
import { Gate, type JobGates } from './gate.js';
import { SingleExecutor } from './singleExecutor.js';
import { BUSY_STATUSES, type JobStatus, type JobEvent } from './events.js';
import { interruptibleSleep, type SleepOptions } from './sleep.js';

export interface JobInfo {
  status: JobStatus;
  projectId: string | null;
  summary: RunSummary;
  row: number;
  total: number;
  /** succeeded + skipped + failed. In parallel mode `row` lost its meaning. */
  done: number;
  /** File names of the rows currently generating. */
  inFlight: string[];
}

export interface JobOptions {
  projectId: string;
  config: Config;
  rows: Row[];
  tabs: GenerationTab[];
  restartBrowser: () => Promise<void>;
  logger: Logger;
  isCompleted: (fileName: string) => boolean;
  recordFailure: (row: Row, reason: string) => void;
  /** Injected in tests; defaults to interruptibleSleep. */
  sleepEngine?: (ms: number, options: SleepOptions) => Promise<void>;
}

const EMPTY_SUMMARY: RunSummary = { succeeded: 0, skipped: 0, failed: 0 };

function newGates(): JobGates {
  return { limit: new Gate(), user: new Gate(), restart: new Gate() };
}

/** The state machine of one generation job; broadcasts events to listeners. */
export class JobManager {
  private status: JobStatus = 'idle';
  private projectId: string | null = null;
  private summary: RunSummary = { ...EMPTY_SUMMARY };
  private row = 0;
  private total = 0;
  private inFlight = new Set<string>();

  private controller = new AbortController();
  private gate = new Gate();
  /**
   * Three coordination pairs. `Gate` says "no one pulls a new row while the
   * work is being handled", `SingleExecutor` says "only one worker does the
   * work". Because the wrapping stops here, `worker.ts` contains no
   * coordination code at all.
   */
  private gates: JobGates = newGates();
  private limitExecutor = new SingleExecutor();
  private userExecutor = new SingleExecutor();
  private restartExecutor = new SingleExecutor();
  private userResolver: (() => void) | null = null;
  private listeners = new Set<(event: JobEvent) => void>();
  /** Status before pause(); resume() returns to it (running or waitingLimit). */
  private statusBeforePause: JobStatus | null = null;

  info(): JobInfo {
    const summary = { ...this.summary };
    return {
      status: this.status,
      projectId: this.projectId,
      summary,
      row: this.row,
      total: this.total,
      done: summary.succeeded + summary.skipped + summary.failed,
      inFlight: [...this.inFlight],
    };
  }

  listen(listener: (event: JobEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(options: JobOptions): Promise<RunSummary> {
    if (this.isRunning()) throw new Error('bir iş zaten çalışıyor');

    this.controller = new AbortController();
    this.gate = new Gate();
    this.gates = newGates();
    this.limitExecutor = new SingleExecutor();
    this.userExecutor = new SingleExecutor();
    this.restartExecutor = new SingleExecutor();
    this.userResolver = null;
    this.statusBeforePause = null;
    this.projectId = options.projectId;
    this.summary = { ...EMPTY_SUMMARY };
    this.row = 0;
    this.total = options.rows.length;
    this.inFlight.clear();

    const sleepEngine = options.sleepEngine ?? interruptibleSleep;

    try {
      // The first status broadcast lives inside the try: if a listener throws
      // unexpectedly here (emit now swallows listener exceptions, but defense
      // in depth) the manager must not hang in 'running' forever.
      this.setStatus('running');

      const summary = await processAllRows(
        {
          config: options.config,
          tabs: options.tabs,
          restartBrowser: () => this.restart(options.restartBrowser),
          logger: options.logger,
          control: { signal: this.controller.signal, gate: this.gate },
          gates: this.gates,
          sleep: (ms, reason) => this.sleepAndEmit(sleepEngine, ms, reason),
          isCompleted: options.isCompleted,
          recordFailure: options.recordFailure,
          waitForUser: (message) => this.waitForUser(message),
          onRowStarted: (row, total, record) => {
            this.row = row;
            this.total = total;
            this.inFlight.add(record.dosyaAdi);
            this.emit({ type: 'rowStarted', row, total, fileName: record.dosyaAdi });
          },
          onRowFinished: (row, result, reason) => {
            // The worker never calls onRowStarted for skipped rows; `row` must
            // still be updated here, or info() would report row:0 when the job ends.
            this.row = row;
            if (result === 'succeeded') this.summary.succeeded++;
            else if (result === 'skipped') this.summary.skipped++;
            else this.summary.failed++;

            const record = options.rows[row - 1];
            const fileName = record?.dosyaAdi ?? '';
            this.inFlight.delete(fileName);

            if (result === 'succeeded' && record) {
              this.emit({ type: 'imageReady', fileName });
            }
            this.emit({
              type: 'rowFinished',
              row,
              fileName,
              result,
              summary: { ...this.summary },
              reason,
            });
          },
        },
        options.rows,
      );

      this.summary = summary;
      this.setStatus(this.controller.signal.aborted ? 'stopped' : 'finished');
      this.emit({ type: 'finished', summary });
      return summary;
    } catch (error) {
      const message = (error as Error).message;
      this.setStatus('error');
      this.emit({ type: 'error', message });
      throw error;
    }
  }

  pause(): void {
    if (this.status !== 'running' && this.status !== 'waitingLimit') return;
    this.statusBeforePause = this.status;
    this.gate.close();
    this.setStatus('paused');
  }

  resume(): void {
    if (this.status !== 'paused') return;
    // If paused during a rate-limit sleep, return to the pre-pause
    // 'waitingLimit' status, not 'running'; otherwise the UI would say
    // "running" while the rate-limit countdown still ticks in the background.
    const targetStatus = this.statusBeforePause ?? 'running';
    this.statusBeforePause = null;
    this.gate.open();
    this.setStatus(targetStatus);
  }

  stop(): void {
    if (!this.isRunning()) return;
    this.controller.abort();
    // Open every gate so waiting workers loop back and observe the abort
    this.gate.open();
    this.gates.limit.open();
    this.gates.user.open();
    this.gates.restart.open();
    this.userResolver?.();
    this.userResolver = null;
  }

  userReady(): void {
    if (this.controller.signal.aborted) return;
    if (this.status !== 'waitingUser') return;
    const resolve = this.userResolver;
    this.userResolver = null;
    this.setStatus('running');
    resolve?.();
  }

  private isRunning(): boolean {
    return BUSY_STATUSES.includes(this.status);
  }

  private async sleepAndEmit(
    engine: (ms: number, options: SleepOptions) => Promise<void>,
    ms: number,
    reason: SleepReason,
  ): Promise<void> {
    if (reason === 'transientError') this.emit({ type: 'transientError' });

    if (reason !== 'rateLimit') {
      await engine(ms, { signal: this.controller.signal, gate: this.gate });
      return;
    }

    // Only one of N workers sleeps; the rest JOIN the same sleep — otherwise
    // 3 workers × 15 min would serialize into 45 min. The gate meanwhile keeps
    // a worker that finished its in-flight row from pulling a NEW one during
    // the sleep.
    await this.limitExecutor.run(async () => {
      this.gates.limit.close();
      this.setStatus('waitingLimit');
      try {
        await engine(ms, {
          signal: this.controller.signal,
          gate: this.gate,
          tick: (remainingMs) =>
            this.emit({ type: 'limitWaiting', remainingSec: Math.round(remainingMs / 1000) }),
        });
      } finally {
        this.gates.limit.open();
      }

      if (this.status === 'waitingLimit' && !this.controller.signal.aborted) {
        this.setStatus('running');
      }
    });
  }

  /**
   * On a browser crash: only the first worker really restarts, later calls
   * join the same operation. The gate keeps workers waiting at the top of the
   * loop from pulling rows and pointlessly burning retry attempts while the
   * restart runs.
   */
  private restart(rawRestart: () => Promise<void>): Promise<void> {
    return this.restartExecutor.run(async () => {
      this.gates.restart.close();
      try {
        await rawRestart();
      } finally {
        this.gates.restart.open();
      }
    });
  }

  private waitForUser(message: string): Promise<void> {
    if (this.controller.signal.aborted) return Promise.resolve();

    // The first to see it pops the card; the other workers JOIN the same wait —
    // no N separate "log in" cards. One confirmation resolves them all.
    return this.userExecutor.run(async () => {
      this.gates.user.close();
      try {
        await this.singleUserWait(message);
      } finally {
        this.gates.user.open();
      }
    });
  }

  private singleUserWait(message: string): Promise<void> {
    // The resolver must be assigned BEFORE any event is emitted. Otherwise a
    // synchronous listener reacting to those events with stop()/userReady()
    // (while userResolver is still null) could resolve nothing, and the
    // returned promise would hang forever.
    const wait = new Promise<void>((resolve) => {
      this.userResolver = resolve;
    });

    this.setStatus('waitingUser');
    this.emit({ type: 'userNeeded', message });

    // Status check after the emits: if stop() was called in between (from a
    // synchronous listener) the resolver was already consumed and nulled —
    // normal flow. But if the abort happened while the resolver is still
    // assigned (unconsumed), resolve the promise right here to avoid hanging.
    if (this.controller.signal.aborted && this.userResolver) {
      const resolve = this.userResolver;
      this.userResolver = null;
      resolve();
    }

    return wait;
  }

  private setStatus(status: JobStatus): void {
    this.status = status;
    this.emit({ type: 'status', status, projectId: this.projectId, summary: { ...this.summary } });
  }

  private emit(event: JobEvent): void {
    // Every listener is isolated: if one throws (e.g. an SSE client closes the
    // connection and the write throws EPIPE) neither the other listeners nor
    // the generation job must be affected. The error is not lost silently, it
    // is logged.
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('is olayi dinleyicisinde hata:', error);
      }
    }
  }
}
