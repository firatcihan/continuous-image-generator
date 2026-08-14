import { sleep as realSleep } from '../wait.js';
import type { Gate } from './gate.js';

export interface SleepOptions {
  signal?: AbortSignal;
  gate?: Gate;
  /** Called at the start of every slice with the remaining time. */
  tick?: (remainingMs: number) => void;
  /** Slice length; defaults to 1 second. */
  stepMs?: number;
  /** Injected in tests; defaults to the real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Splits the sleep into slices; cancelable and pausable.
 * Needed so a 15-minute rate-limit wait reacts to Stop immediately.
 */
export async function interruptibleSleep(ms: number, options: SleepOptions = {}): Promise<void> {
  const { signal, gate, tick, stepMs: stepMsInput = 1000, sleep = realSleep } = options;
  // A zero or negative stepMs makes the slice size zero/negative, never
  // advances `remaining` and loops forever; force a safe lower bound.
  const stepMs = Math.max(1, stepMsInput);

  let remaining = ms;
  while (remaining > 0) {
    if (signal?.aborted) return;
    if (gate) await gate.pass();
    if (signal?.aborted) return;

    tick?.(remaining);
    const slice = Math.min(stepMs, remaining);
    await sleep(slice);
    remaining -= slice;
  }
}
