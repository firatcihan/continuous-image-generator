import { api } from './api.js';
import { update } from './status.js';
import { loadProjects } from './projects.js';

const DELAY_MS = 800;

let timer = null;
let pending = null;
/**
 * The promise of the write currently in flight (null when none).
 *
 * `flushPending` can be called CONCURRENTLY from two places: the debounce
 * timer fires by itself while the user clicks another project and calls it
 * through `selectProject` in projects.js. Without this variable the second
 * call sees `pending` as `null` (the first call already cleared it) and
 * returns without waiting — `selectProject` takes that as "nothing to save"
 * and switches immediately, then when the first call's network request
 * resolves, `update({ activeProject: ... })` writes the OLD project's data
 * over the NEW one. `inFlight` makes the second call wait for the first to
 * finish, so `selectProject` only continues the switch after the write
 * completed.
 */
let inFlight = null;

/**
 * "Generation" counter — distinguishes whether a result belongs to the form
 * the user last left, or to an OLDER form already gone from the screen.
 * It increments both when a new save is scheduled (`scheduleSave`) and when a
 * field turns invalid (`markInvalid`) — both mean "the user changed the form".
 *
 * Why it is needed: when a write request settles (`write`), it describes the
 * form state AT THE MOMENT IT WAS SENT. While the network request ran, the
 * user may have touched the form (made a new edit or turned a field invalid) —
 * then the settling request describes a moment OLDER than what the user sees
 * NOW. Only the INDICATOR fields (`saveStatus`/`saveTime`/`error`) are
 * written when the counter is unchanged; `activeProject` is always merged
 * (so the server-stamped `guncellemeTarihi` is not lost), and that merge is
 * only safe thanks to `renderEditor`'s `renderedProjectId` guard, which never
 * rewrites field values unless the `id` changed.
 */
let generation = 0;

/**
 * Autosave. An explicit "Save" button was a data-loss trap with many
 * projects: edit → click another project → the change silently vanished.
 *
 * Only state that PASSES VALIDATION arrives here; while invalid the caller
 * uses `markInvalid()` and no write is ever scheduled.
 */
export function scheduleSave(project) {
  pending = project;
  generation++;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => void flushPending(), DELAY_MS);
}

/** Writes the pending save immediately — no debounce wait while switching projects. */
export async function flushPending() {
  // If a write is already in flight, wait for it first (see note above).
  if (inFlight !== null) await inFlight;

  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  const project = pending;
  pending = null;
  if (project === null) return;

  inFlight = write(project);
  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}

async function write(project) {
  // The generation this write request belongs to — checked when the request
  // settles to see whether it is still current.
  const thisGeneration = generation;

  update({ saveStatus: 'saving' });
  try {
    const written = await api.saveProject(project.id, project);
    if (thisGeneration === generation) {
      // No new user input in between: this write still describes the freshest
      // form state on screen, the indicator may be updated.
      update({
        activeProject: written,
        saveStatus: 'saved',
        saveTime: new Date().toLocaleTimeString('tr-TR'),
        error: null,
      });
    } else {
      // The user touched the form while this write ran (scheduled a new save
      // or made a field invalid) — the indicator now belongs to THAT state
      // and must not be crushed by this OLD write's "saved" stamp. Still,
      // `activeProject` is merged so the server-returned `guncellemeTarihi`
      // is not lost; that is safe because `renderEditor` only writes field
      // values when the project `id` changes (it did not change here), so
      // the characters the user is typing right now are untouched.
      update({ activeProject: written });
    }
  } catch (error) {
    // Same logic in reverse: if this write is stale, do not write its failure
    // onto the indicator either — it must not override a newer "invalid" or
    // (when the next write settles) a newer "saved".
    if (thisGeneration === generation) {
      update({ saveStatus: 'invalid', error: error.message });
    }
  }

  // Refreshes the name and row count in the left panel. DELIBERATELY outside
  // the try/catch above: inside it, this request's failure hit the catch and
  // the indicator said "Geçersiz — kaydedilmedi" even though the save WAS
  // written. The panel refresh does not affect the save's correctness, so
  // its failure is only logged.
  try {
    await loadProjects();
  } catch (error) {
    console.warn('sol panel tazelenemedi:', error);
  }
}

export function markInvalid(reason) {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  pending = null;
  generation++;
  update({ saveStatus: 'invalid', error: reason });
}
