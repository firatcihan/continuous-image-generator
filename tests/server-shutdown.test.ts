import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ProjectStore } from '../src/store/projects.js';
import { JobManager } from '../src/job/jobManager.js';
import { createServer } from '../src/server/index.js';

const TOKEN = 'test-token';

let root: string;
let app: ReturnType<typeof createServer>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sunucu-kapanis-'));
  const web = join(root, 'web');
  mkdirSync(web, { recursive: true });
  writeFileSync(join(web, 'index.html'), '<h1>merhaba</h1>', 'utf-8');

  app = createServer({
    store: new ProjectStore(root, join(root, 'cikti')),
    jobManager: new JobManager(),
    startJob: () => {},
    openBrowser: async () => {},
    isBrowserOpen: () => true,
    token: TOKEN,
    allowedOrigin: () => '',
    webFolder: web,
    openFolder: () => {},
  });
});

afterEach(async () => {
  await app.close().catch(() => {});
  rmSync(root, { recursive: true, force: true });
});

/** Resolves to 'timeout' instead of hanging, so a stuck close() is a failure not a frozen run. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([
    promise,
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms)),
  ]);
}

// The UI page holds an SSE connection open for its whole lifetime. Fastify's
// close() waits for open connections to drain by default, and an SSE response
// never ends on its own — so start.ts's SIGINT handler awaited close() forever
// and never reached process.exit(0). Ctrl+C did nothing; the user had to
// kill -9. The server must therefore force such connections shut.
it('close() returns while an SSE stream is still open', async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as { port: number }).port;

  const response = await fetch(`http://127.0.0.1:${port}/api/job/stream?t=${TOKEN}`);
  // Read the opening `status` event so the stream is genuinely established,
  // not merely requested.
  await response.body!.getReader().read();

  expect(await withTimeout(app.close(), 3000)).not.toBe('timeout');
});
