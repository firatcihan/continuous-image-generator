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

  let browser: ChatgptBrowser | null = null;

  /**
   * Opens the browser and navigates to chatgpt.com — does not start a job.
   * The user logs in to ChatGPT in this window, then presses Start.
   */
  const openBrowser = async (): Promise<void> => {
    if (browser) return;
    const fresh = new ChatgptBrowser(profile, (message) => logger.info(message));
    await fresh.launch(); // on failure `browser` stays null, can be retried
    browser = fresh;
    logger.info('tarayıcı açıldı; ChatGPT girişi kullanıcıya bırakıldı');
  };

  /** Closes the browser and resets state; a close failure does not affect the job. */
  const closeBrowser = async (): Promise<void> => {
    const open = browser;
    browser = null; // reset first: even if closing hangs, the UI sees "closed"
    await open?.close().catch(() => {});
  };

  const startJob = (project: Project): void => {
    void (async () => {
      try {
        mkdirSync(project.ciktiKlasoru, { recursive: true });
        await openBrowser();
        // Local invariant: the `browser` narrowing does not carry into the closure below.
        const openedBrowser = browser;
        if (!openedBrowser) throw new Error('tarayıcı açılamadı');

        const config = configFromProject(project, profile);
        // Clamp: no point opening 4 tabs for a 2-row project.
        const tabCount = Math.min(config.esZamanliSekme, Math.max(project.satirlar.length, 1));
        const tabs = await openedBrowser.prepareTabs(tabCount);

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
          await closeBrowser();
          logger.info(
            `iş bitti (başarılı ${summary.succeeded}, atlanan ${summary.skipped}, ` +
              `başarısız ${summary.failed}); tarayıcı kapatıldı`,
          );
        }
      } catch (error) {
        logger.error(`iş başarısız: ${(error as Error).message}`);
      }
    })();
  };

  // The real port is only known after listen(); because allowedOrigin is a
  // function it is read at request time and the server does not need to be
  // brought up twice.
  let address = '';

  const app = createServer({
    store, jobManager, startJob, token,
    openBrowser,
    isBrowserOpen: () => browser !== null,
    allowedOrigin: () => address,
    webFolder: web, openFolder,
  });

  await app.listen({ port: Number(process.env.PORT ?? 0), host: '127.0.0.1' });
  const port = (app.server.address() as { port: number }).port;
  address = `http://127.0.0.1:${port}`;

  const url = `${address}/?t=${token}`;
  console.log(`\n  ChatGPT Görsel Üretici çalışıyor:\n  ${url}\n`);
  openUrl(url);

  const shutdown = async () => {
    await app.close();
    await browser?.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(`ölümcül hata: ${(error as Error).message}`);
  process.exit(1);
});
