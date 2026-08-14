import { api } from './api.js';
import { state, update } from './status.js';
import { notifyChange } from './editor.js';

const $ = (id) => document.getElementById(id);

/** 'table' | 'csv' | 'script' — which editor is open. */
let mode = 'table';

/**
 * CSV parse "generation" counter. Every keystroke fires a parse request at
 * the server; responses do NOT have to come back IN ORDER. Without the
 * counter: the user types "a" then "b", B's response returns before A's, then
 * A's response clobbers `state.rows` with the OLD text's rows and that stale
 * state is handed to autosave — the screen shows "ab" while "a"'s rows go to
 * disk. The counter silently drops the stale response.
 */
let csvGeneration = 0;

/**
 * The single source of truth for rows is `state.rows`. This module writes,
 * `editor.js` reads — so there is no import cycle between the two modules
 * (the import direction is one way: list → editor).
 */
const rows = () => state.rows;

function writeRows(fresh, valid = true) {
  update({ rows: fresh, rowsValid: valid });
}

/**
 * Lets the server do the parsing in CSV mode. Parsing is not duplicated in
 * the browser: two copies drift over time, and the user's CSV would pass in
 * the browser yet be rejected by the server.
 *
 * Returns: `'ok'` (rows written), `'error'` (+ message, state marked
 * invalid) or `'stale'` — a newer request started while this one ran, the
 * caller must do nothing (neither write rows nor draw a warning).
 */
async function refreshFromCsv() {
  const thisGeneration = ++csvGeneration;
  try {
    const result = await api.parseCsv($('csvArea').value);
    if (thisGeneration !== csvGeneration) return { status: 'stale' };
    writeRows(result.rows, true);
    return { status: 'ok' };
  } catch (error) {
    if (thisGeneration !== csvGeneration) return { status: 'stale' };
    update({ rowsValid: false });
    return { status: 'error', message: error.message };
  }
}

/**
 * Serializes rows to CSV text. This direction (serialization) stays in the
 * browser: unlike the parsing rules it is one line of escaping logic, not
 * worth a server round trip. (Header names are the user-facing CSV contract.)
 */
function toCsv(records) {
  const escape = (field) => (/[",\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field);
  return ['metin,dosya_adi', ...records.map((r) => `${escape(r.metin)},${escape(r.dosyaAdi)}`)]
    .join('\n');
}

/** Refreshes internal data when the active project changes. */
export function renderList() {
  if (state.activeProject === null) {
    // Clear the stamp: if the same id is selected again (the 404 recovery
    // path can drop to the empty state and come back) a lingering stamp would
    // skip rebuilding the table, leaving stale rows on screen even though
    // `state.rows` was refreshed.
    $('tableWrap').dataset.projectId = '';
    return;
  }

  // Rebuilding the table while the user types loses the cursor; internal data
  // is reloaded only when the project id changes.
  if ($('tableWrap').dataset.projectId !== state.activeProject.id) {
    $('tableWrap').dataset.projectId = state.activeProject.id;
    mode = 'table';
    renderTable();
  }
  renderModeShell();
}

function renderModeShell() {
  $('tableWrap').hidden = mode !== 'table';
  $('csvArea').hidden = mode !== 'csv';
  $('scriptArea').hidden = mode !== 'script';
  $('btnAddRow').hidden = mode !== 'table';
  $('btnConvert').hidden = mode !== 'script';

  for (const [button, value] of [
    ['btnModeTable', 'table'], ['btnModeCsv', 'csv'], ['btnModeScript', 'script'],
  ]) {
    $(button).classList.toggle('active', mode === value);
  }
  $('rowCount').textContent = `(${rows().length})`;
}

function renderTable() {
  const wrap = $('tableWrap');
  wrap.textContent = '';

  const table = document.createElement('table');
  table.className = 'row-table';
  const head = document.createElement('tr');
  for (const title of ['Metin (varyasyon)', 'Dosya adı', '']) {
    const cell = document.createElement('th');
    cell.textContent = title;
    head.append(cell);
  }
  table.append(head);

  rows().forEach((row, index) => {
    const tr = document.createElement('tr');

    // Field names mirror the persisted Row schema (metin/dosyaAdi) — do not rename.
    for (const field of ['metin', 'dosyaAdi']) {
      const td = document.createElement('td');
      const input = document.createElement('input');
      input.type = 'text';
      input.value = row[field];
      input.placeholder = field === 'metin' ? 'kar yağarken dağ evinde' : 'dag_evi_kis';

      input.addEventListener('input', () => {
        // Mutate the array in place and write the same reference back: since
        // the table is not rebuilt, the cursor stays put.
        const current = rows();
        current[index][field] = input.value;
        writeRows(current, true);
        refreshMarkers();
        void notify();
      });
      td.append(input);
      tr.append(td);
    }

    const deleteCell = document.createElement('td');
    deleteCell.className = 'delete';
    const del = document.createElement('button');
    del.textContent = '×';
    del.title = 'Satırı sil';
    del.addEventListener('click', () => {
      const current = rows();
      current.splice(index, 1);
      writeRows(current, true);
      renderTable();
      renderModeShell();
      void notify();
    });
    deleteCell.append(del);
    tr.append(deleteCell);

    table.append(tr);
  });

  wrap.append(table);
  // Compute the markers from one place: no rule drift between build time and
  // keystroke time.
  refreshMarkers();
}

/**
 * Duplicate file names for the red-marker hint.
 *
 * Names are compared TRIMMED, both in counting and in lookup: the count used
 * to run on trimmed names while the lookup used the RAW value, so in an
 * `"a "` / `"a"` pair only one turned red.
 *
 * This is only a HINT. The server has the last word: `sanitizeFileName` also
 * strips a trailing `.png` and replaces `\ / : * ? " < > |` with `_`, so
 * `foo.png` and `foo` clash on the server but not here. We do not copy those
 * rules here — same rationale as the spec's decision to keep CSV parsing in
 * one place: a second copy drifts over time. When the server returns 400 the
 * indicator says "Geçersiz — kaydedilmedi" and the message names the
 * clashing row.
 */
function duplicateNames() {
  const counts = new Map();
  for (const row of rows()) {
    const name = row.dosyaAdi.trim();
    if (name !== '') counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
}

/** Update only the red markers without rebuilding the table. */
function refreshMarkers() {
  const duplicates = duplicateNames();
  const domRows = $('tableWrap').querySelectorAll('tr');

  domRows.forEach((tr, index) => {
    if (index === 0) return; // header
    const record = rows()[index - 1];
    if (record === undefined) return;
    const inputs = tr.querySelectorAll('input');
    inputs[0]?.classList.toggle('invalid', record.metin.trim() === '');

    const clash = duplicates.has(record.dosyaAdi.trim());
    inputs[1]?.classList.toggle('invalid', record.dosyaAdi.trim() === '' || clash);
    // The tooltip must update here too: written only at build time, the
    // "also exists in another row" hint would stay stuck on the cell after
    // the user fixes the name.
    if (inputs[1] !== undefined) {
      inputs[1].title = clash ? 'Bu dosya adı başka satırda da var' : '';
    }
  });
  $('rowCount').textContent = `(${rows().length})`;
}

/** Writes the validation result on the warning line, then informs the editor. */
async function notify() {
  const warning = $('rowWarning');

  if (mode === 'csv') {
    const result = await refreshFromCsv();
    // A newer parse has started: leave both the warning and the save to it.
    if (result.status === 'stale') return;
    const error = result.status === 'error' ? result.message : null;
    warning.hidden = error === null;
    warning.textContent = error === null ? '' : `CSV geçersiz — ${error}`;
  } else {
    // In table mode empty/duplicate cells show red; the server returns 400
    // and the indicator says "Geçersiz — kaydedilmedi".
    const broken = rows().some((r) => r.metin.trim() === '' || r.dosyaAdi.trim() === '') ||
      duplicateNames().size > 0;
    warning.hidden = !broken;
    warning.textContent = broken ? 'Boş veya tekrar eden satır var — kaydedilmiyor' : '';
  }

  await notifyChange();
}

/**
 * Converts the script into rows. Parsing happens on the server; on error the
 * existing rows are NOT touched — no partial write, all or nothing.
 */
async function convert() {
  const warning = $('rowWarning');
  let fresh;
  try {
    const result = await api.parseScript($('scriptArea').value);
    fresh = result.rows;
  } catch (error) {
    warning.hidden = false;
    warning.textContent = `Script çevrilemedi — ${error.message}`;
    return;
  }

  const existing = rows().length;
  if (existing > 0 && !(await confirmOverwrite(existing, fresh.length))) return;

  warning.hidden = true;
  warning.textContent = '';
  writeRows(fresh, true);
  mode = 'table';
  renderTable();
  renderModeShell();
  void notify();
}

/** Confirmation before overwriting a filled list — hand-entered rows must not vanish by accident. */
function confirmOverwrite(existing, incoming) {
  const dialog = $('convertDialog');
  $('convertMessage').textContent =
    `${existing} satır silinip ${incoming} yeni satırla değiştirilecek.`;

  return new Promise((resolve) => {
    // Listeners are attached on every open and removed on close: if they were
    // permanent, a second conversion would also trigger the old promises.
    const close = (result) => {
      dialog.close();
      $('convertConfirm').removeEventListener('click', confirm);
      $('convertCancel').removeEventListener('click', cancel);
      resolve(result);
    };
    const confirm = () => close(true);
    const cancel = () => close(false);

    $('convertConfirm').addEventListener('click', confirm);
    $('convertCancel').addEventListener('click', cancel);
    dialog.showModal();
  });
}

export function bindList() {
  $('btnAddRow').addEventListener('click', () => {
    writeRows([...rows(), { metin: '', dosyaAdi: '' }], true);
    renderTable();
    renderModeShell();
    // `notify()` is required: an empty row makes the project invalid. Without
    // the call no save is scheduled and the indicator stays on the previous
    // "Kaydedildi" stamp — the user thinks an unsaved row is saved.
    void notify();
  });

  /**
   * Switches modes. When LEAVING CSV with a failed parse, the mode does not
   * change: walking away from invalid CSV would lose the rows the user typed.
   */
  async function switchMode(target) {
    if (target === mode) return;

    if (mode === 'csv') {
      const result = await refreshFromCsv();
      if (result.status === 'stale') return;
      if (result.status === 'error') {
        $('rowWarning').hidden = false;
        $('rowWarning').textContent =
          `CSV geçersiz — moddan çıkmadan önce düzeltin (${result.message})`;
        return;
      }
    }

    mode = target;
    if (mode === 'csv') $('csvArea').value = toCsv(rows());
    if (mode === 'table') renderTable();
    renderModeShell();
    void notify();
  }

  $('btnModeTable').addEventListener('click', () => void switchMode('table'));
  $('btnModeCsv').addEventListener('click', () => void switchMode('csv'));
  $('btnModeScript').addEventListener('click', () => void switchMode('script'));

  $('btnConvert').addEventListener('click', () => void convert());

  $('csvArea').addEventListener('input', () => void notify());
  // The script area does NOT touch the rows; it is only saved onto the project.
  $('scriptArea').addEventListener('input', () => void notifyChange());
}
