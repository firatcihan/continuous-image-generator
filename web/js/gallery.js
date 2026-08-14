import { api, imageUrl } from './api.js';
import { state, update } from './status.js';

const $ = (id) => document.getElementById(id);

export async function loadGallery(projectId) {
  if (projectId === null) {
    update({ gallery: { files: [], totalBytes: 0 } });
    return;
  }
  try {
    update({ gallery: await api.gallery(projectId) });
  } catch (error) {
    // The gallery is decoration; its failure must not halt the rest of the
    // screen. Still logged so "the images disappeared" has a visible cause.
    console.warn('galeri yüklenemedi:', error);
    update({ gallery: { files: [], totalBytes: 0 } });
  }
}

export function renderGallery() {
  const wrap = $('gallery');
  const project = state.activeProject;
  if (project === null) {
    wrap.textContent = '';
    wrap.dataset.signature = '';
    return;
  }

  // Do not redraw the same file list — reloading the <img>s flickers
  const signature = `${project.id}:${state.gallery.files.join(',')}`;
  if (wrap.dataset.signature === signature) return;
  wrap.dataset.signature = signature;

  wrap.textContent = '';
  for (const fileName of state.gallery.files) {
    const image = document.createElement('img');
    image.src = imageUrl(project.id, fileName);
    image.alt = fileName;
    image.title = fileName;
    image.loading = 'lazy';
    wrap.append(image);
  }
  if (state.gallery.files.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Henüz görsel yok.';
    wrap.append(empty);
  }
}
