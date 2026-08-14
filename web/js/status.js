/** The single client state. Render functions subscribe, update() notifies. */
export const state = {
  projects: [],
  brokenCount: 0,
  activeProject: null,
  /**
   * The rows being edited. This is the single source of truth: `list.js`
   * writes, `editor.js` reads. That way there is no import cycle between the
   * two modules.
   */
  rows: [],
  /** false when parsing fails in CSV mode — no save is scheduled while invalid. */
  rowsValid: true,
  job: {
    status: 'idle',
    projectId: null,
    row: 0,
    total: 0,
    done: 0,
    /** File names currently generating — in parallel there is no single "current row". */
    inFlight: [],
    summary: { succeeded: 0, skipped: 0, failed: 0 },
    remainingSec: null,
    message: null,
  },
  gallery: { files: [], totalBytes: 0 },
  browserOpen: false,
  /** 'idle' | 'saving' | 'saved' | 'invalid' */
  saveStatus: 'idle',
  saveTime: null,
  streamConnected: false,
  error: null,
};

/**
 * Statuses in which the job occupies the single-job slot. Mirror of
 * BUSY_STATUSES in src/job/events.ts — the web UI cannot import from src/
 * (no build step), so the two copies must be kept in sync by hand.
 */
const BUSY_STATUSES = ['running', 'paused', 'waitingLimit', 'waitingUser'];

const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function update(patch) {
  Object.assign(state, patch);
  for (const listener of listeners) listener(state);
}

/** Is the job running on this project? The read-only lock and the strip look at this. */
export function isProjectRunning(projectId) {
  return BUSY_STATUSES.includes(state.job.status) && state.job.projectId === projectId;
}

export function isJobBusy() {
  return BUSY_STATUSES.includes(state.job.status);
}
