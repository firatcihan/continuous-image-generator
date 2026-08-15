import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectStore, configFromProject, type Project } from './store/projects.js';
import { DEFAULT_OUTPUT_ROOT, DEFAULT_DATA_ROOT, chromeProfilePath } from './store/paths.js';
import { recordFailure, isCompleted } from './status.js';
import { JobManager } from './job/jobManager.js';
import { Logger } from './logger.js';
import { createServer } from './server/index.js';
import { generateToken } from './server/security.js';
import { openFolder, openUrl } from './server/folder.js';
import { ChatgptBrowser } from './browser.js';
import { BrowserSession } from './browserSession.js';
import { claimSingleInstance, lockFilePath, releaseSingleInstance } from './singleInstance.js';

const web = fileURLToPath(new URL('../web', import.meta.url));

async function main(): Promise<void> {
  // Env var names are part of the documented user contract — do not translate.
  const dataRoot = process.env.GORSEL_VERI_KOKU ?? DEFAULT_DATA_ROOT;
  const outputRoot = process.env.GORSEL_CIKTI_KOKU ?? DEFAULT_OUTPUT_ROOT;
  mkdirSync(dataRoot, { recursive: true });

  const token = generateToken();
  const store = new ProjectStore(dataRoot, outputRoot);
  store.migrate();
  const jobManager = new JobManager();
  const logger = new Logger(join(dataRoot, 'calisma.log'));
  const profile = chromeProfilePath(dataRoot);

  // The session answers "is the browser open" from the handle itself, so a
  // window the USER closes is noticed too — see src/browserSession.ts.
  const session = new BrowserSession(() => {
    const fresh = new ChatgptBrowser(profile, (message) => logger.info(message));
    fresh.onClosed(() => logger.info('tarayıcı penceresi dışarıdan kapatıldı'));
    return fresh;
  });

  /**
   * Opens the browser and navigates to chatgpt.com — does not start a job.
   * The user logs in to ChatGPT in this window, then presses Start.
   */
  const openBrowser = async (): Promise<void> => {
    if (session.isOpen()) return;
    await session.open(); // on failure the session stays closed, can be retried
    logger.info('tarayıcı açıldı; ChatGPT girişi kullanıcıya bırakıldı');
  };

  // Returns a promise so the start route can refuse a second start while this
  // one is still preparing. It never rejects: every failure is handled below.
  const startJob = (project: Project): Promise<void> =>
    (async () => {
      // Everything before `jobManager.start()` runs AFTER the route already
      // answered 202. If it throws, the manager never took the job over, so it
      // is on us to report the failure — see the catch below.
      let handedOver = false;
      try {
        mkdirSync(project.ciktiKlasoru, { recursive: true });
        await openBrowser();
        // Local invariant: the session's narrowing does not carry into the closure below.
        const openedBrowser = session.get();
        if (!openedBrowser) throw new Error('tarayıcı açılamadı');

        const config = configFromProject(project, profile);
        // Clamp: no point opening 4 tabs for a 2-row project.
        const tabCount = Math.min(config.esZamanliSekme, Math.max(project.satirlar.length, 1));
        const tabs = await openedBrowser.prepareTabs(tabCount);

        handedOver = true;
        const summary = await jobManager.start({
          projectId: project.id,
          config,
          rows: project.satirlar,
          tabs,
          restartBrowser: () => openedBrowser.relaunch(),
          logger,
          isCompleted: (fileName) => isCompleted(project.ciktiKlasoru, fileName),
          recordFailure: (row, reason) =>
            recordFailure(join(project.ciktiKlasoru, 'basarisizlar.csv'), row, reason),
        });

        // If the job finished on its own, close the browser — after a 200-image
        // run no Chromium window should be left around. When the user STOPPED
        // we do not close: stopping usually means they want to look at something.
        if (jobManager.info().status === 'finished') {
          await session.close();
          logger.info(
            `iş bitti (başarılı ${summary.succeeded}, atlanan ${summary.skipped}, ` +
              `başarısız ${summary.failed}); tarayıcı kapatıldı`,
          );
        }
      } catch (error) {
        const message = (error as Error).message;
        logger.error(`iş başarısız: ${message}`);
        // `jobManager.start()` reports its own failures (status 'error' + the
        // event). Only a throw from BEFORE the hand-over would otherwise go
        // unseen — the route already replied 202, so without this the user
        // presses Başlat and nothing whatsoever happens on screen.
        if (!handedOver) jobManager.fail(message, project.id);
      }
    })();

  // The real port is only known after listen(); because allowedOrigin is a
  // function it is read at request time and the server does not need to be
  // brought up twice.
  let address = '';

  const app = createServer({
    store, jobManager, startJob, token,
    openBrowser,
    isBrowserOpen: () => session.isOpen(),
    allowedOrigin: () => address,
    webFolder: web, openFolder,
  });

  await app.listen({ port: Number(process.env.PORT ?? 0), host: '127.0.0.1' });
  const port = (app.server.address() as { port: number }).port;
  address = `http://127.0.0.1:${port}`;

  const url = `${address}/?t=${token}`;

  // Claimed only once the port is known, so the message can carry a URL that
  // actually works. A second instance would share `chrome_profil` with this
  // one and its Chromium would die on launch — see src/singleInstance.ts.
  const lockPath = lockFilePath(dataRoot);
  const claim = claimSingleInstance(lockPath, { pid: process.pid, url });
  if (!claim.claimed) {
    await app.close();
    console.log(
      `\n  ChatGPT Görsel Üretici zaten çalışıyor (pid ${claim.running.pid}):\n` +
        `  ${claim.running.url}\n\n` +
        `  İkinci bir kopya aynı Chrome profilini kullanacağı için tarayıcı açılamaz.\n` +
        `  O pencere kapandıysa: kill ${claim.running.pid}\n`,
    );
    openUrl(claim.running.url);
    return;
  }

  console.log(`\n  ChatGPT Görsel Üretici çalışıyor:\n  ${url}\n`);
  openUrl(url);

  const shutdown = async () => {
    await app.close();
    await session.close();
    releaseSingleInstance(lockPath, process.pid);
    process.exit(0);
  };
  // SIGINT/SIGTERM are the normal exits, but a crash (or SIGHUP from a closed
  // terminal) would otherwise leave a lock behind that blocks the next start
  // until its pid happens to be free again.
  process.on('exit', () => releaseSingleInstance(lockPath, process.pid));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(`ölümcül hata: ${(error as Error).message}`);
  process.exit(1);
});
