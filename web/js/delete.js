import { api } from './api.js';
import { state } from './status.js';
import { addLog } from './progress.js';
import { selectProject, loadProjects } from './projects.js';

const $ = (id) => document.getElementById(id);

let target = null;

function sizeText(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The dialog opens SYNCHRONOUSLY, the image count fills in later. Waiting for
 * the count before opening caused two problems: (1) on a slow disk the user
 * saw nothing for a while after clicking `×`, (2) two quick clicks started
 * two `openDialog`s and the second `showModal()` threw `InvalidStateError` on
 * the already-open dialog — an uncaught rejection in the console because of
 * the `void openDialog(...)` call.
 */
async function openDialog(summary) {
  const dialog = $('deleteDialog');
  if (dialog.open) return;

  target = summary;
  $('deleteTitle').textContent = `"${summary.ad}" projesini sil?`;
  $('deleteFolder').textContent = summary.ciktiKlasoru;
  $('deleteCount').textContent = 'Görseller sayılıyor…';
  $('deleteImages').checked = true;
  dialog.showModal();

  // Count and size come from the server, not a client guess
  let gallery = { files: [], totalBytes: 0 };
  try {
    gallery = await api.gallery(summary.id);
  } catch (error) {
    // If the folder is unreadable show 0; deletion is still attempted
    console.warn('görsel sayısı okunamadı:', error);
  }
  // The user may have closed the dialog and opened another before the count returned
  if (target === null || target.id !== summary.id) return;
  $('deleteCount').textContent =
    `${gallery.files.length} görsel (${sizeText(gallery.totalBytes)})`;
}

async function confirm() {
  if (target === null) return;
  const deleteImages = $('deleteImages').checked;
  const removed = target;
  target = null;
  $('deleteDialog').close();

  try {
    const result = await api.deleteProject(removed.id, deleteImages);

    if (result.protectedFolder) {
      addLog(
        `"${removed.ad}" kaydı silindi. Çıktı klasörü tek bir projeye ait görünmediği için ` +
        `görseller silinmedi — elle silin: ${removed.ciktiKlasoru}`,
      );
    } else if (result.undeletable.length > 0) {
      addLog(
        `"${removed.ad}" silindi. ${result.deleted} görsel silindi, ` +
        `${result.undeletable.length} dosya silinemedi: ${result.undeletable.join(', ')}`,
      );
    } else {
      addLog(`"${removed.ad}" silindi (${result.deleted} görsel).`);
    }
  } catch (error) {
    addLog(`silinemedi: ${error.message}`, 'err');
    return;
  }

  await loadProjects();
  // If the deleted project was open: fall back to the first project, or the empty state when none remain
  if (state.activeProject !== null && state.activeProject.id === removed.id) {
    location.hash = '';
    const first = state.projects[0];
    await selectProject(first ? first.id : null);
  }
}

export function bindDelete() {
  document.addEventListener('project-delete-request', (event) => void openDialog(event.detail));
  $('deleteConfirm').addEventListener('click', () => void confirm());
  $('deleteCancel').addEventListener('click', () => $('deleteDialog').close());
  // Closing with Escape presses no button; clear the target in one place so a
  // stale target never lingers while the dialog is closed.
  $('deleteDialog').addEventListener('close', () => { target = null; });
}
