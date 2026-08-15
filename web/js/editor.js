import { api } from './api.js';
import { state, isProjectRunning } from './status.js';
import { markInvalid, scheduleSave } from './save.js';

const $ = (id) => document.getElementById(id);

/** Mirrors `PLACEHOLDER` in src/prompt.ts — it is part of the saved prompts. */
const PLACEHOLDER = '{VARYASYON}';

// `key` values are persisted ProjectSettings field names (Turkish, on-disk
// schema); `label`/`hint` are user-facing UI text (Turkish by design).
const SETTING_FIELDS = [
  { key: 'modelAdi', label: 'Beklenen model adı', type: 'text',
    hint: 'Boş bırakılırsa model kontrolü atlanır.' },
  { key: 'uretimZamanAsimiSn', label: 'Üretim zaman aşımı (sn)', type: 'number' },
  { key: 'tekrarDenemeSayisi', label: 'Tekrar deneme sayısı', type: 'number' },
  { key: 'rateLimitVarsayilanBeklemeDk', label: 'Limit varsayılan bekleme (dk)', type: 'number' },
  { key: 'esZamanliSekme', label: 'Eş zamanlı sekme', type: 'number', max: 4,
    hint: '1 = sırayla. Yükseltmek üretimi hızlandırır, ama ChatGPT kotası hesap '
      + 'başınadır — limit daha erken gelebilir.' },
];

/** Reads everything in the form and builds a complete project object. */
export function projectFromForm() {
  const base = state.activeProject;
  if (base === null) return null;

  return {
    ...base,
    ad: $('setting-ad').value.trim(),
    basePrompt: $('basePrompt').value,
    script: $('scriptArea').value,
    ciktiKlasoru: $('setting-ciktiKlasoru').value.trim(),
    // The single source of truth for rows is status.js; list.js writes, this reads
    satirlar: state.rowsValid ? state.rows.map((r) => ({ ...r })) : null,
    ayarlar: {
      modelAdi: $('setting-modelAdi').value,
      satirArasiBekleme: [Number($('setting-waitMin').value), Number($('setting-waitMax').value)],
      uretimZamanAsimiSn: Number($('setting-uretimZamanAsimiSn').value),
      tekrarDenemeSayisi: Number($('setting-tekrarDenemeSayisi').value),
      rateLimitVarsayilanBeklemeDk: Number($('setting-rateLimitVarsayilanBeklemeDk').value),
      esZamanliSekme: Number($('setting-esZamanliSekme').value),
    },
  };
}

/** Client-side validation before saving. Returns an error text or null. */
function validateProject(project) {
  const [min, max] = project.ayarlar.satirArasiBekleme;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || min > max) {
    return 'Bekleme aralığı geçersiz (min ≤ maks olmalı)';
  }
  for (const field of ['uretimZamanAsimiSn', 'tekrarDenemeSayisi', 'rateLimitVarsayilanBeklemeDk']) {
    if (!Number.isFinite(project.ayarlar[field]) || project.ayarlar[field] <= 0) {
      return `${field} pozitif bir sayı olmalı`;
    }
  }
  const tabs = project.ayarlar.esZamanliSekme;
  if (!Number.isInteger(tabs) || tabs < 1 || tabs > 4) {
    return 'Eş zamanlı sekme 1 ile 4 arasında tam sayı olmalı';
  }
  if (project.satirlar === null) return 'Satır listesi geçersiz';
  if (project.ad === '') return 'Proje adı boş olamaz';
  if (project.ciktiKlasoru === '') return 'Çıktı klasörü boş olamaz';
  return null;
}

/** Something changed: refresh the preview, validate, schedule a save. */
export async function notifyChange() {
  const project = projectFromForm();
  if (project === null) return;

  const error = validateProject(project);
  if (error !== null) {
    markInvalid(error);
  } else {
    scheduleSave(project);
  }

  await refreshPreview(project);
  renderSaveIndicator();
}

/**
 * The preview request can reject on a network failure or an unexpected
 * server response (e.g. dropped connection). That must NOT affect autosave —
 * validation and `scheduleSave` already run independently of the preview.
 * Uncaught, the `await` inside `notifyChange` would blow up here,
 * `renderSaveIndicator()` would never run, and an unhandled rejection would
 * appear in the console (the fire-and-forget call in `renderEditor` carries
 * the same risk).
 */
async function refreshPreview(project) {
  try {
    const result = await api.preview(project.id, project.basePrompt, project.satirlar ?? []);

    $('promptWarning').hidden = result.hasPlaceholder;
    $('promptWarning').textContent =
      'Prompt içinde {VARYASYON} yok — her satır aynı görseli üretirdi';
    $('basePrompt').classList.toggle('invalid', !result.hasPlaceholder);

    const segments = project.basePrompt.split(PLACEHOLDER);
    const list = $('preview');
    list.textContent = '';

    // No rows yet (or none valid): the prompt itself is the preview, with the
    // placeholders as chips — so the highlight is live while typing, before
    // there is anything to substitute. Without a placeholder there is nothing
    // to show; the warning line above says so already.
    if (result.previews.length === 0) {
      if (result.hasPlaceholder) list.append(previewLine(segments, 'VARYASYON'));
      return;
    }

    // `buildPreviews` renders the first N rows in order, so preview `index`
    // belongs to row `index`.
    result.previews.forEach((text, index) => {
      const metin = project.satirlar?.[index]?.metin;
      list.append(metin === undefined || segments.join(metin) !== text
        ? plainLine(text)
        : previewLine(segments, metin));
    });
  } catch (error) {
    // The preview is purely visual; its failure must not block saving. It is
    // still logged, so if the list gets stuck stale (possibly wrong) the
    // cause is visible.
    console.error('önizleme tazelenemedi:', error);
  }
}

/**
 * A preview line where the text sitting in place of `{VARYASYON}` is drawn as
 * a chip: `segments` are the parts of the base prompt around the placeholder,
 * `chipText` is what goes between them.
 */
function previewLine(segments, chipText) {
  const item = document.createElement('li');
  segments.forEach((segment, index) => {
    if (segment !== '') item.append(segment);
    if (index < segments.length - 1) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = chipText;
      item.append(chip);
    }
  });
  return item;
}

/**
 * The server's own text, unchanged. It has the last word on what actually gets
 * submitted, so a line that does not rebuild EXACTLY from the segments is
 * written out plainly rather than shown with chips in the wrong places.
 */
function plainLine(text) {
  const item = document.createElement('li');
  item.textContent = text;
  return item;
}

export function renderSaveIndicator() {
  const texts = {
    idle: '',
    saving: 'Kaydediliyor…',
    saved: `Kaydedildi ${state.saveTime ?? ''}`,
    invalid: `Geçersiz — kaydedilmedi${state.error ? ` (${state.error})` : ''}`,
  };
  $('saveStatus').textContent = texts[state.saveStatus] ?? '';
}

/** Which project's form has been filled — avoids rewriting field values needlessly. */
let renderedProjectId = null;

/**
 * Runs on every `update()` call. Field values are written ONLY when the
 * project changes: assigning `input.value` throws the cursor to the end, and
 * every autosave would displace the cursor while the user types.
 */
export function renderEditor() {
  const project = state.activeProject;
  if (project === null) {
    renderedProjectId = null;
    return;
  }

  if (renderedProjectId !== project.id) {
    $('basePrompt').value = project.basePrompt;
    $('scriptArea').value = project.script;
    renderSettings(project);
    renderedProjectId = project.id;
    void refreshPreview(projectFromForm());
  }

  const locked = isProjectRunning(project.id);
  $('lockWarning').hidden = !locked;
  $('projectScreen').classList.toggle('locked', locked);

  renderSaveIndicator();
}

function renderSettings(project) {
  const wrap = $('settings');
  if (wrap.dataset.built === '1') {
    // The fields already exist; only write values — no cursor loss while typing
    $('setting-ad').value = project.ad;
    $('setting-modelAdi').value = project.ayarlar.modelAdi;
    $('setting-ciktiKlasoru').value = project.ciktiKlasoru;
    $('setting-waitMin').value = project.ayarlar.satirArasiBekleme[0];
    $('setting-waitMax').value = project.ayarlar.satirArasiBekleme[1];
    for (const field of SETTING_FIELDS.slice(1)) {
      $(`setting-${field.key}`).value = project.ayarlar[field.key];
    }
    return;
  }

  wrap.textContent = '';

  // Renaming does NOT move the output folder (see the note below): the two are
  // separate fields on purpose, so the images already produced are not left
  // behind in a folder nobody looks at any more.
  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Proje adı';
  nameLabel.title = 'Ad değişince çıktı klasörü olduğu yerde kalır.';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.id = 'setting-ad';
  nameInput.value = project.ad;
  nameLabel.htmlFor = nameInput.id;
  wrap.append(nameLabel, nameInput);

  // The output folder is not inside `ayarlar`, it is a root field of the
  // project — but a setting to the user. It does not change automatically
  // with the name (spec §3): produced images must not be left alone in the
  // old folder.
  const folderLabel = document.createElement('label');
  folderLabel.textContent = 'Çıktı klasörü';
  folderLabel.title = 'İki proje aynı klasörü kullanamaz.';
  const folderInput = document.createElement('input');
  folderInput.type = 'text';
  folderInput.id = 'setting-ciktiKlasoru';
  folderInput.value = project.ciktiKlasoru;
  folderLabel.htmlFor = folderInput.id;
  wrap.append(folderLabel, folderInput);

  const waitLabel = document.createElement('label');
  waitLabel.textContent = 'Satır arası bekleme (sn, min – maks)';
  waitLabel.htmlFor = 'setting-waitMin'; // two-field row: the label points at min
  wrap.append(waitLabel);
  const waitWrap = document.createElement('div');
  waitWrap.className = 'row';
  for (const [id, value] of [
    ['setting-waitMin', project.ayarlar.satirArasiBekleme[0]],
    ['setting-waitMax', project.ayarlar.satirArasiBekleme[1]],
  ]) {
    const input = document.createElement('input');
    input.type = 'number';
    input.id = id;
    input.min = '0';
    input.value = String(value);
    waitWrap.append(input);
  }
  wrap.append(waitWrap);

  // The remaining fields side by side: all short values, no need for full width.
  const grid = document.createElement('div');
  grid.className = 'settings-grid';
  for (const field of SETTING_FIELDS) {
    const cell = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = field.label;
    if (field.hint) label.title = field.hint;
    const input = document.createElement('input');
    input.type = field.type;
    input.id = `setting-${field.key}`;
    if (field.type === 'number') input.min = '1';
    if (field.max !== undefined) input.max = String(field.max);
    input.value = String(project.ayarlar[field.key]);
    label.htmlFor = input.id;
    cell.append(label, input);
    grid.append(cell);
  }
  wrap.append(grid);

  wrap.dataset.built = '1';
  wrap.addEventListener('input', () => void notifyChange());
}

export function bindEditor() {
  $('basePrompt').addEventListener('input', () => void notifyChange());

  $('btnPlaceholder').addEventListener('click', () => {
    const area = $('basePrompt');
    const start = area.selectionStart ?? area.value.length;
    area.value = `${area.value.slice(0, start)}{VARYASYON}${area.value.slice(start)}`;
    area.focus();
    void notifyChange();
  });
}
