import { startStream } from './stream.js';
import { api } from './api.js';
import { subscribe, state } from './status.js';
import { bindEditor, renderEditor } from './editor.js';
import { renderGallery } from './gallery.js';
import { bindProgress, renderProgress, refreshJobStatus, addLog } from './progress.js';
import { bindList, renderList } from './list.js';
import { selectProject, renderProjects, loadProjects, openNewProjectRow } from './projects.js';
import { bindDelete } from './delete.js';

const $ = (id) => document.getElementById(id);

function idFromHash() {
  const match = location.hash.match(/^#\/proje\/([a-z0-9-]+)$/);
  return match ? match[1] : null;
}

async function route() {
  const id = idFromHash();
  if (id !== null) {
    if (!state.activeProject || state.activeProject.id !== id) await selectProject(id);
    return;
  }
  // No hash: the alphabetically first project. No projects at all: empty state.
  const first = state.projects[0];
  await selectProject(first ? first.id : null);
}

async function start() {
  subscribe(renderProjects);
  // The row table renders before the editor: both read from `state`, but
  // having the table built on project switch keeps the row counter next to
  // the preview list consistent within the same pass.
  subscribe(renderList);
  subscribe(renderEditor);
  subscribe(renderGallery);
  subscribe(renderProgress);

  bindEditor();
  bindList();
  bindProgress();
  bindDelete();

  $('btnNewProject').addEventListener('click', () => openNewProjectRow());
  $('btnSettings').addEventListener('click', () => {
    // The fields are built by `renderSettings` when a project is selected;
    // they stay in the DOM while the dialog is closed and `projectFromForm()`
    // keeps reading them.
    if (state.activeProject !== null) $('settingsDialog').showModal();
  });
  $('settingsClose').addEventListener('click', () => $('settingsDialog').close());
  $('btnFolder').addEventListener('click', async () => {
    if (state.activeProject === null) return;
    try {
      await api.openFolder(state.activeProject.id);
    } catch (error) {
      addLog(`klasör açılamadı: ${error.message}`);
    }
  });
  window.addEventListener('hashchange', () => void route());

  await loadProjects();
  await route();
  // The SSE opening event carries no row/total; for a page refreshed
  // mid-job, seed the numbers once over HTTP (see progress.js).
  await refreshJobStatus();
  startStream();

  renderProjects();
  renderProgress();
}

void start();
