import { randomDurationMs } from './wait.js';
import { outputPath } from './status.js';
import type { JobGates, Gate } from './job/gate.js';
import type { Logger } from './logger.js';
import { buildPrompt } from './prompt.js';
import { detectRateLimit } from './rateLimit.js';
import { isFileSystemError } from './fsError.js';
import type { Config, RunSummary, Row, GenerationTab } from './types.js';

export type SleepReason = 'betweenRows' | 'rateLimit' | 'transientError' | 'startup';

/**
 * Wait before retrying when ChatGPT returns a transient error.
 * Kept short: this is not a rate limit, it is a momentary server-side hiccup.
 */
const TRANSIENT_ERROR_WAIT_MS = 10_000;

/**
 * How many times a single row may send the user a "fix this and press Devam"
 * card before we stop asking and just try. Guards against a wrong DOM check
 * trapping the user in a loop only Durdur can break — see `processRow`.
 */
const MAX_USER_WAITS = 5;

export interface JobControl {
  signal: AbortSignal;
  gate: Gate;
}

export interface WorkerDeps {
  config: Config;
  tabs: GenerationTab[];
  restartBrowser: () => Promise<void>;
  logger: Logger;
  control: JobControl;
  gates: JobGates;
  sleep: (ms: number, reason: SleepReason) => Promise<void>;
  isCompleted: (fileName: string) => boolean;
  recordFailure: (row: Row, reason: string) => void;
  waitForUser: (message: string) => Promise<void>;
  onRowStarted: (row: number, total: number, record: Row) => void;
  onRowFinished: (row: number, result: 'succeeded' | 'skipped' | 'failed', reason?: string) => void;
}

export async function processAllRows(d: WorkerDeps, rows: Row[]): Promise<RunSummary> {
  const summary: RunSummary = { succeeded: 0, skipped: 0, failed: 0 };
  let cursor = 0;

  // NO `await` between reading and incrementing — Node is single-threaded so
  // this is atomic; two workers can never pull the same row.
  const next = (): { row: number; record: Row } | null =>
    cursor < rows.length ? { row: ++cursor, record: rows[cursor - 1] } : null;

  await Promise.all(
    d.tabs.map((tab, index) => runWorker(d, tab, index, next, summary, rows.length)),
  );

  return summary;
}

/** Pause plus the three coordination gates. All passed in one place. */
async function passGates(d: WorkerDeps): Promise<void> {
  await d.control.gate.pass();
  await d.gates.limit.pass();
  await d.gates.user.pass();
  await d.gates.restart.pass();
}

/**
 * Processes rows on a single tab until the queue drains.
 *
 * `workerIndex` exists only for the staggered start: if N prompts fly in the
 * same millisecond the automation footprint grows, and if the account is
 * already limited, N workers discover the limit simultaneously and burn N
 * retry attempts at once.
 */
async function runWorker(
  d: WorkerDeps,
  tab: GenerationTab,
  workerIndex: number,
  next: () => { row: number; record: Row } | null,
  summary: RunSummary,
  total: number,
): Promise<void> {
  if (workerIndex > 0) {
    await d.sleep(workerIndex * randomDurationMs(d.config.satirArasiBekleme), 'startup');
  }

  for (;;) {
    if (d.control.signal.aborted) return;
    await passGates(d);
    if (d.control.signal.aborted) return;

    const job = next();
    if (job === null) return; // queue drained, the worker retires

    const { row, record } = job;

    if (d.isCompleted(record.dosyaAdi)) {
      d.logger.info(`[${row}/${total}] atlandı (zaten var): ${record.dosyaAdi}.png`);
      summary.skipped++;
      d.onRowFinished(row, 'skipped');
      continue;
    }

    d.logger.info(`[${row}/${total}] işleniyor: ${record.dosyaAdi}`);
    d.onRowStarted(row, total, record);

    const result = await processRow(d, tab, record);
    if (result.ok) {
      summary.succeeded++;
      d.onRowFinished(row, 'succeeded');
    } else {
      summary.failed++;
      d.onRowFinished(row, 'failed', result.reason);
    }

    await d.sleep(randomDurationMs(d.config.satirArasiBekleme), 'betweenRows');
  }
}

interface RowResult {
  ok: boolean;
  reason?: string;
}

async function processRow(
  d: WorkerDeps,
  tab: GenerationTab,
  record: Row,
): Promise<RowResult> {
  const prompt = buildPrompt(d.config.basePrompt, record.metin);
  let attempt = 0;
  /** How many times we waited on someone else's restart — livelock brake. */
  let restartWaits = 0;
  /** How many times we asked the user to fix something for THIS row. */
  let userWaits = 0;

  let lastReason = 'bilinmiyor';

  while (attempt < d.config.tekrarDenemeSayisi) {
    if (d.control.signal.aborted) return { ok: false, reason: 'durduruldu' };
    await d.control.gate.pass();
    if (d.control.signal.aborted) return { ok: false, reason: 'durduruldu' };

    try {
      await tab.openNewChat();

      // Both checks below read ChatGPT's DOM and can simply be WRONG — a
      // login button lingering in some logged-in state, a renamed model
      // switcher. When that happens the user is trapped: they press Devam, the
      // same card pops straight back, and the only way out is Durdur. Their
      // repeated confirmation is better evidence than our own selector, so
      // past this many asks we stop checking and just attempt generation. A
      // genuinely dead session then fails through the normal retry path, with
      // a real error instead of a loop.
      const trustUser = userWaits >= MAX_USER_WAITS;

      if (!trustUser && !(await tab.isLoggedIn())) {
        userWaits++;
        d.logger.warn('oturum kapalı görünüyor; kullanıcı girişi bekleniyor');
        await d.waitForUser(
          'ChatGPT oturumu kapalı. Açılan tarayıcıda elle giriş yapın, sonra Devam edin.',
        );
        continue; // no retry attempt burned
      }

      if (!trustUser && d.config.modelAdi !== '') {
        const activeModel = await tab.activeModelName();
        if (!activeModel.toLowerCase().includes(d.config.modelAdi.toLowerCase())) {
          userWaits++;
          d.logger.warn(`beklenen model "${d.config.modelAdi}", aktif model "${activeModel}"`);
          await d.waitForUser(
            `Yanlış model seçili (aktif: "${activeModel}", beklenen: "${d.config.modelAdi}"). ` +
              'Tarayıcıdan doğru modeli seçin, sonra Devam edin.',
          );
          continue; // no retry attempt burned
        }
      }

      if (trustUser && userWaits === MAX_USER_WAITS) {
        userWaits++; // log the crossing once, not on every later pass
        d.logger.warn(
          `${MAX_USER_WAITS} onaya rağmen kontroller geçmedi; kontroller atlanıp` +
            ` üretim deneniyor (satır: ${record.dosyaAdi})`,
        );
      }

      const result = await tab.generateImage(prompt, d.config.uretimZamanAsimiSn);

      switch (result.type) {
        case 'image': {
          await tab.saveLastImage(outputPath(d.config.ciktiKlasoru, record.dosyaAdi));
          d.logger.info(`kaydedildi: ${record.dosyaAdi}.png`);
          return { ok: true };
        }
        case 'rateLimit': {
          const minutes = detectRateLimit(result.message).waitMinutes ?? d.config.rateLimitVarsayilanBeklemeDk;
          d.logger.warn(`rate limit algılandı; ${minutes} dk bekleniyor (satır: ${record.dosyaAdi})`);
          await d.sleep(minutes * 60_000, 'rateLimit');
          continue; // same row, no retry attempt burned
        }
        case 'refusal': {
          const reason = `içerik reddi: ${result.message.slice(0, 200)}`;
          d.logger.warn(`${reason} (satır: ${record.dosyaAdi})`);
          d.recordFailure(record, reason);
          return { ok: false, reason };
        }
        case 'transientError': {
          attempt++;
          lastReason = 'geçici hata (ChatGPT)';
          d.logger.warn(
            `ChatGPT geçici hata verdi (${attempt}/${d.config.tekrarDenemeSayisi}): ${record.dosyaAdi}` +
              ` — ${result.message.slice(0, 120)}`,
          );
          if (attempt < d.config.tekrarDenemeSayisi) {
            await d.sleep(TRANSIENT_ERROR_WAIT_MS, 'transientError');
          }
          break;
        }
        case 'timeout': {
          attempt++;
          lastReason = 'üretim zaman aşımı';
          d.logger.warn(`üretim zaman aşımı (${attempt}/${d.config.tekrarDenemeSayisi}): ${record.dosyaAdi}`);
          break;
        }
      }
    } catch (error) {
      // If the error comes from a restart ANOTHER worker started ("sekme N
      // hazır değil", "Target closed") it is not this row's fault: the context
      // was pulled out from under it. No retry attempt is burned; once the
      // restart finishes the same row is retried on a fresh tab. The counter
      // is a brake against a pathological loop: back-to-back restarts must not
      // spin the row forever.
      if (!d.gates.restart.isOpen() && restartWaits < 5) {
        restartWaits++;
        d.logger.warn(
          `tarayıcı yeniden başlatılıyor (başka işçi); ${record.dosyaAdi} bekletildi` +
            ` — deneme hakkı yakılmadı`,
        );
        // The gate is awaited only HERE, not at the top of the loop: a worker
        // that has not attempted yet already passed the gates in `runWorker`;
        // making it wait again would also freeze a tab that never saw the crash.
        await d.gates.restart.pass();
        continue;
      }

      attempt++;
      const message = (error as Error).message;

      // A full disk, a vanished output folder or a permission problem is not
      // something relaunching Chromium can fix. Restarting for it cost a full
      // browser cycle PLUS the retry budget on EVERY remaining row, turning a
      // clean failure into hours of thrashing. Let the row fail fast instead;
      // the reason lands in basarisizlar.csv where the user can act on it.
      if (isFileSystemError(error)) {
        lastReason = `görsel kaydedilemedi: ${message.slice(0, 120)}`;
        d.logger.error(
          `dosya yazma hatası (${attempt}/${d.config.tekrarDenemeSayisi}): ${message};` +
            ' tarayıcı yeniden başlatılmıyor — sorun diskte',
        );
        continue;
      }

      lastReason = `tarayıcı hatası: ${message.slice(0, 120)}`;
      d.logger.error(
        `tarayıcı hatası (${attempt}/${d.config.tekrarDenemeSayisi}): ${message}; yeniden başlatılıyor`,
      );
      await d.restartBrowser();
    }
  }

  // Include the kind of the last failure: "retry count exceeded" alone does
  // not let the user diagnose — timeout, ChatGPT error, or browser crash?
  const reason = `tekrar deneme sayısı aşıldı (${d.config.tekrarDenemeSayisi}) — son sebep: ${lastReason}`;
  d.recordFailure(record, reason);
  return { ok: false, reason };
}
