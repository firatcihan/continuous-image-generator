import type { RunSummary } from '../types.js';

export type JobStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'waitingLimit'
  | 'waitingUser'
  | 'finished'
  | 'stopped'
  | 'error';

/**
 * Statuses in which the job occupies the single-job slot. Single source of
 * truth for the server side; web/js/status.js keeps its own copy because the
 * web UI cannot import from src/ (no build step).
 */
export const BUSY_STATUSES: readonly JobStatus[] = [
  'running', 'paused', 'waitingLimit', 'waitingUser',
];

export type JobEvent =
  | { type: 'status'; status: JobStatus; projectId: string | null; summary: RunSummary }
  | { type: 'rowStarted'; row: number; total: number; fileName: string }
  | { type: 'imageReady'; fileName: string }
  | {
      type: 'rowFinished';
      row: number;
      /** So the UI can remove the row from its "generating" list. */
      fileName: string;
      result: 'succeeded' | 'skipped' | 'failed';
      /** Fresh summary on every row so the counters stay live through the run. */
      summary: RunSummary;
      reason?: string;
    }
  | { type: 'limitWaiting'; remainingSec: number }
  /** ChatGPT returned a transient error; will retry after a short wait. */
  | { type: 'transientError' }
  | { type: 'userNeeded'; message: string }
  | { type: 'error'; message: string }
  | { type: 'finished'; summary: RunSummary };
