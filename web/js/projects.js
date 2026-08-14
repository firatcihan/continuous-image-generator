import { api } from './api.js';
import { state, update, isProjectRunning } from './status.js';
import { loadGallery } from './gallery.js';
import { flushPending } from './save.js';

const $ = (id) => document.getElementById(id);

export async function loadProjects() {
  const list = await api.projects();
  update({ projects: list.projects, brokenCount: list.brokenCount });
}

/** Rows are kept separately: list.js edits them, editor.js reads from there. */
async function applyProject(project) {
  update({
    activeProject: project,
    rows: project.satirlar.map((r) => ({ ...r })),
    rowsValid: true,
    error: null,
  });
  if (location.hash !== `#/proje/${project.id}`) location.hash = `#/proje/${project.id}`;
  // The gallery loads here, not in `selectProject`'s body: the recovery path
  // (falling back to the first project after a 404) also passes through here;
  // otherwise the gallery would keep showing the deleted project's images.
  await loadGallery(project.id);
}

/** Loads the active project and syncs the hash. With a null id, shows the empty state. */
export async function selectProject(id) {
  // If an autosave is pending, write it without waiting for the debounce —
  // no change may be lost while switching projects.
  await flushPending();
  if (id === null) {
    update({ activeProject: null });
    await loadGallery(null);
    return;
  }
  try {
    await applyProject(await api.project(id));
  } catch (error) {
    // Unknown id (404): clear the hash, REFRESH the list and fall back to the
    // first project once — one refresh + one single retry, then the empty
    // state. The OLD version called `selectProject` recursively here; the
    // list was never refreshed so the "first project" stayed stale and an
    // unknown id kept hitting the SAME error, hammering the API in an
    // unbounded loop with no backoff. One attempt + no recursion closes that.
    //
    // `loadProjects()` and the single retry must sit inside an INNER
    // try/catch: `api.projects()`/`api.project()` can also throw on an
    // expired session cookie (401) or a dropped connection. If that throw
    // leaked past the outer `catch`, the promise returned by `selectProject`
    // would reject; most call sites are fire-and-forget
    // (`() => void selectProject(...)` in projects.js, `() => void route()`
    // in app.js) so it would surface as an UNHANDLED REJECTION, never
    // reaching the user; and in `start()` a throwing `await route()` would
    // skip the trailing `renderProjects()`, leaving the page half built.
    // That is why EVERYTHING thrown here lands in the same clean end state:
    // no project, no hash, error visible.
    update({ activeProject: null, error: error.message });
    location.hash = '';
    try {
      await loadProjects();
      const first = state.projects[0];
      if (first === undefined) return;
      await applyProject(await api.project(first.id));
    } catch (recoveryError) {
      update({ activeProject: null, error: recoveryError.message });
    }
  }
}

export function renderProjects() {
  const wrap = $('projectList');

  // While redrawing the list, preserve an open new-project input if there is
  // one — otherwise every update() would erase the name the user is typing.
  // Only an input NOT YET SUBMITTED (not disabled) counts as "open":
  // create() disables the input while a request is in flight, so an ongoing
  // submission is not mistaken here for a "draft to reopen" and brought back
  // moments later as a ghost row (see the openNewProjectRow comment in
  // projects.js).
  const openInput = wrap.querySelector('.new-project-input:not(:disabled)');
  const openValue = openInput === null ? null : openInput.value;
  wrap.textContent = '';

  for (const summary of state.projects) {
    const row = document.createElement('div');
    row.className = 'project-row';
    if (state.activeProject && state.activeProject.id === summary.id) row.classList.add('active');

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = summary.ad;
    row.append(name);

    if (isProjectRunning(summary.id)) {
      const marker = document.createElement('span');
      marker.className = 'running';
      marker.textContent = '▶';
      row.append(marker);
    }

    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = String(summary.satirSayisi);
    row.append(count);

    const del = document.createElement('button');
    del.className = 'delete';
    del.textContent = '×';
    del.title = 'Projeyi sil';
    del.addEventListener('click', (event) => {
      event.stopPropagation();
      document.dispatchEvent(new CustomEvent('project-delete-request', { detail: summary }));
    });
    row.append(del);

    row.addEventListener('click', () => void selectProject(summary.id));
    wrap.append(row);
  }

  const warning = $('brokenWarning');
  warning.hidden = state.brokenCount === 0;
  warning.textContent =
    `${state.brokenCount} proje dosyası okunamadı ve ".bozuk" olarak kenara alındı.`;

  $('emptyState').hidden = state.projects.length > 0;
  $('projectScreen').hidden = state.activeProject === null;
  $('projectName').textContent = state.activeProject ? state.activeProject.ad : '—';
  // With no project there is no settings form for the gear to open
  $('btnSettings').hidden = state.activeProject === null;

  if (openValue !== null) {
    openNewProjectRow();
    wrap.querySelector('.new-project-input').value = openValue;
  }
}

/**
 * Opens an editable empty row at the end of the left panel: Enter creates,
 * Esc or leaving it empty on blur cancels. No separate form screen — the
 * embodiment of the "type a name, the rest is automatic" decision.
 *
 * The guard at the top of `create()` matters: disabling the input (the Enter
 * path) or removing the row from the DOM (the Esc/empty-blur path)
 * SYNCHRONOUSLY TRIGGERS a blur in the browser — which calls the same
 * `create()` a second time, by itself. Without the guard: pressing Enter
 * fires a second `api.createProject` right after `disabled = true`, and the
 * SAME PROJECT is created TWICE; pressing Esc ignores the "cancel" intent via
 * the blur triggered by `row.remove()` and creates the project anyway.
 * `closed` cuts both. `input.isConnected` additionally catches the row being
 * detached from the DOM by an unrelated `renderProjects()` call (e.g. a
 * redraw triggered by some other event): the input may still have
 * `closed = false` but is no longer in the document — in that case we bail
 * without submitting, and the text is preserved in a fresh row by the
 * "preserve the open input" logic above.
 *
 * `create()`'s `catch` block never reuses the SAME row after
 * `api.createProject` rejects — merely calling `update({ error })` triggers
 * `renderProjects()`, which unconditionally tears down `#projectList`; a
 * "preserved" input comes back as a fresh twin, not the old node. So the
 * original `input` is already out of the document at that point — the catch
 * goes straight to `openNewProjectRow()` for a fresh row and moves the typed
 * name there.
 */
export function openNewProjectRow() {
  const wrap = $('projectList');
  if (wrap.querySelector('.new-project-input') !== null) {
    wrap.querySelector('.new-project-input').focus();
    return;
  }

  const row = document.createElement('div');
  row.className = 'project-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'new-project-input';
  input.placeholder = 'Proje adı…';

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    row.remove();
  };

  const create = async () => {
    if (closed || !input.isConnected) return;
    const name = input.value.trim();
    if (name === '') {
      close();
      return;
    }
    closed = true; // the redraw will remove the row anyway
    input.disabled = true;
    try {
      const project = await api.createProject(name);
      await loadProjects();
      await selectProject(project.id);
    } catch (error) {
      // `update({ error })` just triggered `renderProjects()` (its only
      // subscriber), and that tears down ALL children of #projectList with
      // `wrap.textContent = ''` unconditionally — disabled or not, a
      // "preserved" input only comes back as a fresh twin, never the old
      // node (see renderProjects). So the original `input` is NEVER still in
      // the document here; an "reuse the same row" branch calling `focus()`
      // on it would be dead code. The only path: open a fresh row and move
      // the typed name into it.
      update({ error: error.message });
      openNewProjectRow();
      const fresh = $('projectList').querySelector('.new-project-input');
      if (fresh !== null) fresh.value = name;
    }
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void create();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
  input.addEventListener('blur', () => void create());

  row.append(input);
  wrap.append(row);
  input.focus();
}
