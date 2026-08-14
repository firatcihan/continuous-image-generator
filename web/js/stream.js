import { state, update } from './status.js';
import { loadGallery } from './gallery.js';
import { addLog, refreshBrowserStatus } from './progress.js';
import { loadProjects } from './projects.js';

/**
 * SSE is opened with `EventSource`, which cannot carry headers — that is why
 * the token travels in a cookie (same origin, so the cookie goes automatically).
 */
export function startStream() {
  const source = new EventSource('/api/job/stream');

  source.addEventListener('open', () => update({ streamConnected: true }));

  source.addEventListener('error', () => {
    // EventSource reconnects on its own; just lower the indicator
    update({ streamConnected: false });
  });

  source.addEventListener('message', (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    void handleEvent(data);
  });
}

/** Terminal job statuses — the browser may have been closed in these. */
const END_STATUSES = ['finished', 'stopped', 'error'];

/** Turkish log labels for rowFinished results (UI text stays Turkish). */
const RESULT_LABELS = { succeeded: 'başarılı', skipped: 'atlandı', failed: 'başarısız' };

const doneCount = (summary) => summary.succeeded + summary.skipped + summary.failed;

async function handleEvent(event) {
  const job = { ...state.job };

  switch (event.type) {
    case 'status':
      job.status = event.status;
      job.projectId = event.projectId;
      job.summary = event.summary;
      job.done = doneCount(event.summary);
      if (event.status !== 'waitingLimit') job.remainingSec = null;
      if (event.status !== 'waitingUser') job.message = null;
      update({ job, streamConnected: true });
      // Job over: `start.ts` closes Chromium on a self-finished run; reread
      // the status so the buttons reflect reality (see progress.js).
      if (END_STATUSES.includes(event.status)) await refreshBrowserStatus();
      return;

    case 'rowStarted':
      job.row = event.row;
      job.total = event.total;
      job.inFlight = [...job.inFlight, event.fileName];
      update({ job });
      addLog(`${event.row}/${event.total} ${event.fileName} başladı`);
      return;

    case 'imageReady':
      addLog(`${event.fileName} hazır`);
      // The gallery only refreshes when that project is open on screen
      if (state.activeProject !== null && state.activeProject.id === state.job.projectId) {
        await loadGallery(state.activeProject.id);
      }
      return;

    case 'rowFinished':
      // The summary refreshes here: the `status` event only arrives on status
      // CHANGES, which used to leave the counters frozen through the run.
      job.summary = event.summary;
      job.done = doneCount(event.summary);
      job.inFlight = job.inFlight.filter((name) => name !== event.fileName);
      update({ job });
      addLog(`${event.row}. satır: ${RESULT_LABELS[event.result] ?? event.result}${event.reason ? ` (${event.reason})` : ''}`);
      return;

    case 'limitWaiting':
      job.remainingSec = event.remainingSec;
      update({ job });
      return;

    // The worker is retrying the row after a transient error. Without a log
    // line the user thinks the screen froze.
    case 'transientError':
      addLog('geçici hata — yeniden denenecek');
      return;

    case 'userNeeded':
      job.message = event.message;
      update({ job });
      addLog(`sizi bekliyor: ${event.message}`);
      return;

    case 'error':
      addLog(`hata: ${event.message}`);
      update({ error: event.message });
      return;

    case 'finished':
      job.summary = event.summary;
      job.done = doneCount(event.summary);
      job.inFlight = [];
      update({ job });
      addLog(
        `bitti — ✓ ${event.summary.succeeded}, atlanan ${event.summary.skipped}, ✗ ${event.summary.failed}`,
      );
      await loadProjects();
      if (state.activeProject !== null) await loadGallery(state.activeProject.id);
      // Read a second time: the `status` event is emitted on the server BEFORE
      // the browser is closed (setStatus -> emit -> start() returns -> only
      // then closeBrowser). So the 'finished' event is the safer moment; the
      // two together close the race in practice.
      await refreshBrowserStatus();
      return;

    default:
      return;
  }
}
