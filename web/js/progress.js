import { api } from './api.js';
import { state, update, isJobBusy, isProjectRunning } from './status.js';
import { selectProject } from './projects.js';

const $ = (id) => document.getElementById(id);

const STATUS_TEXTS = {
  idle: 'Henüz çalıştırılmadı',
  running: 'Çalışıyor',
  paused: 'Duraklatıldı',
  waitingLimit: 'Rate limit — bekleniyor',
  waitingUser: 'Sizi bekliyor',
  finished: 'Bitti',
  stopped: 'Durduruldu',
  error: 'Hata',
};

/**
 * True while a browser-open request is in flight. The button is redrawn by
 * `renderButtons` on every `update()`; without this flag any status event in
 * between reverted the button to "1 · Tarayıcıyı aç" and enabled, letting
 * the user click a second time. The server only rejects a second open AFTER
 * the first one FINISHES (`isBrowserOpen()`), so a second request during the
 * launch would start a second Chromium.
 */
let browserOpening = false;

/**
 * Stop was pressed but the job has not stopped yet.
 *
 * `stop()` only fires the AbortController; the worker sees it at the NEXT
 * CHECKPOINT and may be inside a Playwright wait at that moment (a ~30 s
 * `waitForSelector` in live measurement; up to `uretimZamanAsimiSn` during
 * generation). Meanwhile the status still arrives as 'running' so NOTHING
 * changed on screen — the user assumed the button was broken and clicked
 * again. The flag says so until the job really stops.
 */
let stopPending = false;

export function addLog(text) {
  const line = document.createElement('div');
  line.textContent = `${new Date().toLocaleTimeString('tr-TR')} ${text}`;
  $('log').prepend(line);
  while ($('log').childElementCount > 200) $('log').lastElementChild.remove();
}

/**
 * Reads the job status once over HTTP. The `status` event SSE sends on open
 * does NOT carry `row`/`total` (only status/projectId/summary); those arrive
 * in the stream only with the next `rowStarted`. Without this call a user
 * refreshing the page mid-job would see 0/20 instead of 7/20. `GET /api/job`
 * returns the full `info()`, row/total included.
 */
export async function refreshJobStatus() {
  try {
    const info = await api.job();
    update({
      job: {
        ...state.job,
        status: info.status,
        projectId: info.projectId,
        summary: info.summary,
        row: info.row,
        total: info.total,
        done: info.done,
        inFlight: info.inFlight,
      },
    });
  } catch (error) {
    console.warn('iş durumu okunamadı:', error);
  }
}

export function renderProgress() {
  const project = state.activeProject;
  const job = state.job;
  // The job really stopped (or ended some other way): the wait is over
  if (stopPending && !isJobBusy()) stopPending = false;
  const running = project !== null && isProjectRunning(project.id);
  // Even when the job ENDED (finished/stopped/error) the numbers belong to
  // this project: leaving the last summary only in the log stream forces the
  // user to scroll through history.
  const thisProjectsJob = project !== null && job.projectId === project.id;

  const wrap = $('progress');
  wrap.textContent = '';

  // If SSE dropped, the numbers on screen may be frozen; hiding that would mislead
  if (!state.streamConnected) {
    const broken = document.createElement('p');
    broken.className = 'warning-text';
    broken.textContent = 'Canlı bağlantı yok — yeniden bağlanılıyor…';
    wrap.append(broken);
  }

  const title = document.createElement('p');
  title.textContent = thisProjectsJob
    ? STATUS_TEXTS[job.status] ?? job.status
    : STATUS_TEXTS.idle;
  wrap.append(title);

  if (thisProjectsJob) {
    const counter = document.createElement('p');
    counter.className = 'muted';
    // `done`, not `row`: with three workers at 5, 6 and 7, "row" is undefined in parallel.
    counter.textContent =
      `${job.done}/${job.total} · ✓ ${job.summary.succeeded} · atlanan ${job.summary.skipped} · ✗ ${job.summary.failed}`;
    wrap.append(counter);

    if (job.inFlight.length > 0) {
      const inFlight = document.createElement('p');
      inFlight.className = 'muted';
      inFlight.textContent = `Üretiliyor: ${job.inFlight.join(' · ')}`;
      wrap.append(inFlight);
    }

    if (stopPending) {
      const waiting = document.createElement('p');
      waiting.className = 'warning-text';
      waiting.textContent =
        'Durduruluyor — sıradaki kontrol noktasında bitecek (görsel beklemesi sürebilir).';
      wrap.append(waiting);
    }

    if (running && job.status === 'waitingLimit' && job.remainingSec !== null) {
      const countdown = document.createElement('p');
      countdown.className = 'warning-text';
      countdown.textContent = `Limit bekleniyor — kalan ${job.remainingSec} sn`;
      wrap.append(countdown);
    }
  }

  const userNeeded = running && job.status === 'waitingUser';
  $('userCard').hidden = !userNeeded;
  $('userMessage').textContent = job.message ?? '';

  renderButtons();
  renderStrip();
}

function renderButtons() {
  const project = state.activeProject;
  const thisProject = project !== null && isProjectRunning(project.id);
  const otherJobRunning = isJobBusy() && !thisProject;

  if (browserOpening) {
    $('btnBrowser').textContent = 'Açılıyor…';
    $('btnBrowser').disabled = true;
  } else {
    $('btnBrowser').textContent = state.browserOpen ? '✓ Tarayıcı açık' : '1 · Tarayıcıyı aç';
    $('btnBrowser').disabled = state.browserOpen;
  }

  $('btnStart').disabled = project === null || isJobBusy() || !state.browserOpen;
  $('btnStart').title = otherJobRunning
    ? 'Bir iş zaten çalışıyor'
    : (!state.browserOpen ? 'Önce tarayıcıyı açıp ChatGPT\'ye giriş yapın' : '');

  $('btnPause').disabled = !thisProject || state.job.status === 'paused';
  $('btnResume').disabled = !thisProject || state.job.status !== 'paused';
  $('btnStop').disabled = !thisProject || stopPending;
}

function renderStrip() {
  const strip = $('jobStrip');
  if (!isJobBusy() || state.job.projectId === null) {
    strip.hidden = true;
    return;
  }

  const summary = state.projects.find((p) => p.id === state.job.projectId);
  strip.hidden = false;
  strip.textContent = '';

  const text = document.createElement('span');
  text.textContent =
    `▶ ${summary ? summary.ad : state.job.projectId} — ${state.job.done}/${state.job.total}`;
  strip.append(text);

  // The strip stays visible while the user browses another project; the
  // visible counterpart of the single-job constraint.
  if (state.activeProject === null || state.activeProject.id !== state.job.projectId) {
    const goto = document.createElement('button');
    goto.className = 'goto';
    goto.textContent = 'Projeye git';
    goto.addEventListener('click', () => void selectProject(state.job.projectId));
    strip.append(goto);
  }
}

/**
 * Reads from the server whether the browser is really open.
 *
 * When the job finishes on its own, `start.ts` CLOSES Chromium (no window
 * left around after a 200-image run). The UI had no event to learn that
 * from: the button stayed "✓ Tarayıcı açık" and DISABLED, while Start looked
 * enabled yet got a 409 "Önce tarayıcıyı açıp…" from the server — the user
 * could neither open the browser nor start the job; the only way out was a
 * page refresh. That is why `stream.js` calls this when the job reaches a
 * terminal state.
 */
export async function refreshBrowserStatus() {
  try {
    update({ browserOpen: (await api.browser()).open });
  } catch (error) {
    console.warn('tarayıcı durumu okunamadı:', error);
    update({ browserOpen: false });
  }
}

export function bindProgress() {
  $('btnBrowser').addEventListener('click', async () => {
    if (browserOpening || state.browserOpen) return;
    browserOpening = true;
    renderButtons();
    try {
      await api.openBrowser();
      addLog('tarayıcı açıldı — ChatGPT\'ye giriş yapın');
    } catch (error) {
      addLog(`tarayıcı açılamadı: ${error.message}`);
    } finally {
      browserOpening = false;
    }
    await refreshBrowserStatus();
  });

  $('btnStart').addEventListener('click', async () => {
    if (state.activeProject === null) return;
    try {
      await api.startJob(state.activeProject.id);
    } catch (error) {
      addLog(`başlatılamadı: ${error.message}`);
    }
  });

  $('btnStop').addEventListener('click', async () => {
    stopPending = true;
    renderProgress(); // show "Durduruluyor…" immediately, before the server responds
    try {
      await api.stopJob();
    } catch (error) {
      stopPending = false;
      addLog(error.message);
      renderProgress();
    }
  });

  const actions = [
    ['btnPause', api.pauseJob],
    ['btnResume', api.resumeJob],
    ['btnReady', api.userReady],
  ];
  for (const [id, action] of actions) {
    $(id).addEventListener('click', async () => {
      try {
        await action();
      } catch (error) {
        addLog(error.message);
      }
    });
  }

  void refreshBrowserStatus();
}
