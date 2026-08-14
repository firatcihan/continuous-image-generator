import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { isValidId } from '../store/identity.js';
import type { Project, ProjectStore } from '../store/projects.js';
import { realPathInside, isInside } from '../store/paths.js';
import { BUSY_STATUSES } from '../job/events.js';
import type { JobManager } from '../job/jobManager.js';
import { parseRows } from '../list.js';
import { buildPreviews, hasPlaceholder } from '../prompt.js';
import { scriptToRows } from '../script.js';
import type { Row } from '../types.js';
import { readCookieToken, isRequestAuthorized } from './security.js';

export interface ServerDeps {
  store: ProjectStore;
  jobManager: JobManager;
  startJob: (project: Project) => void;
  /** Opens the browser without starting a job — so the user can log in to ChatGPT. */
  openBrowser: () => Promise<void>;
  isBrowserOpen: () => boolean;
  token: string;
  allowedOrigin: () => string;
  webFolder: string;
  openFolder: (path: string) => void;
}

declare module 'fastify' {
  interface FastifyInstance {
    testJobManager: JobManager;
  }
}

export function createServer(d: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate('testJobManager', d.jobManager);

  // Unexpected error: the body must carry the same shape as every route
  // ({ error }), otherwise the UI cannot read it and the user sees an empty
  // box. ciktiKlasoru is a free-form path from the user, so that path is
  // genuinely reachable (mistaking a file for a folder → ENOTDIR, no
  // permission → EACCES).
  //
  // The `statusCode < 500` branch exists only to preserve the error the
  // `addContentTypeParser` below throws itself, whose message we wrote
  // (malformed JSON) — that error already carries a safe message and must
  // stay a 400. Everything without a `statusCode` (e.g. ENOTDIR/EACCES from
  // fs calls) counts as "unexpected" here: detail goes only to the server
  // console, because fs error messages can contain absolute paths.
  app.setErrorHandler((error, request, reply) => {
    const knownError = error as Error & { statusCode?: number };
    if (typeof knownError.statusCode === 'number' && knownError.statusCode < 500) {
      return reply.code(knownError.statusCode).send({ error: knownError.message });
    }
    console.error(`${request.method} ${request.url} beklenmeyen hata:`, error);
    return reply.code(500).send({ error: 'beklenmeyen sunucu hatası' });
  });

  /** Reads the project; on miss sends 404 and returns null. */
  const projectOr404 = (id: string, reply: FastifyReply): Project | null => {
    const project = isValidId(id) ? d.store.read(id) : null;
    if (project === null) {
      reply.code(404).send({ error: 'proje bulunamadı' });
      return null;
    }
    return project;
  };

  /** True when this project is generating right now — the edit and delete lock. */
  const isProjectRunning = (id: string): boolean =>
    isBusy(d.jobManager) && d.jobManager.info().projectId === id;

  // Browsers send `content-type: application/json` even on bodyless POSTs.
  // Fastify's default parser rejects an empty body with 400
  // (FST_ERR_CTP_EMPTY_JSON_BODY), breaking all bodyless control routes.
  // We treat an empty body as `undefined`; malformed JSON still returns 400.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_request, body, done) => {
      const text = typeof body === 'string' ? body.trim() : '';
      if (text === '') {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(text));
      } catch {
        const error = new Error('gövde geçerli JSON değil') as Error & { statusCode?: number };
        error.statusCode = 400;
        done(error, undefined);
      }
    },
  );

  app.addHook('onRequest', async (request, reply) => {
    // favicon carries no token and returns 204, so it leaks nothing; without
    // the exemption every page load logs a 401 to the console. The exemption
    // is limited to an EXACT path match AND the GET method:
    // `request.url.startsWith('/favicon.ico')` would also match other paths
    // sharing the prefix, like `/favicon.ico/../api/projects`, on a raw
    // socket request (Node's http server does not normalize `..` segments;
    // that normalization only exists in `.inject()` tests or in the browser's
    // fetch/URL handling). Even though no other route shares the prefix
    // today, relying on that would be trusting the router's internals — we
    // drop the query string and compare the ENTIRE path name. The method is
    // pinned to GET too: otherwise `POST /favicon.ico` staying auth-free
    // would depend on no other method being registered on that path (router
    // luck again).
    const pathName = request.url.split('?')[0];
    if (request.method === 'GET' && pathName === '/favicon.ico') return;

    const query = request.query as Record<string, string | undefined>;
    const fromHeader = request.headers['x-token'];
    const headerToken = typeof fromHeader === 'string' ? fromHeader : undefined;
    const queryToken = query?.t;
    const cookieToken = readCookieToken(request.headers.cookie);
    const token = headerToken ?? queryToken ?? cookieToken;
    // True only when header and query are empty AND a value came from the
    // cookie — the extra check below must not affect the other two sources,
    // so the source is tracked separately (isRequestAuthorized's signature
    // stays unchanged; this knowledge is used only here, in the hook).
    const tokenFromCookie = headerToken === undefined && queryToken === undefined && token !== undefined;
    const origin = request.headers.origin;

    if (!isRequestAuthorized({ token, origin }, { token: d.token, allowedOrigin: d.allowedOrigin() })) {
      // The `return` matters: sending the reply alone does not guarantee the
      // request lifecycle stops. Without it, whether the route handler runs
      // is left to Fastify's implicit "reply already sent" detection — an
      // unauthorized request could see a 401 yet still start a job in the
      // background.
      return reply.code(401).send({ error: 'yetkisiz istek' });
    }

    // `SameSite=Strict` only cuts the cookie on CROSS-SITE requests. A page on
    // ANOTHER PORT of 127.0.0.1 counts as the SAME SITE as this server
    // (SameSite is computed per site, not per port) — the cookie still goes.
    // Such a page's sub-resource requests (`<img>`/`<script>`/`<link>`) carry
    // no Origin header at all, and `isRequestAuthorized` accepts a missing
    // Origin. So when the token came from the cookie, the two checks above
    // (token + Origin) are not enough on their own; we additionally require
    // `sec-fetch-site: same-origin` — a cross-port request carries
    // 'same-site', while our own page's fetch/module-import/<img>/EventSource
    // requests carry 'same-origin'. When the header is ABSENT we accept
    // (fail-open): the attack requires a browser, and every browser capable
    // of it sends the header; a client without it is most likely not a
    // browser (curl, tests), where the cookie is no threat anyway — rejecting
    // on absence would buy no security, only break those clients.
    if (tokenFromCookie) {
      const fetchSite = request.headers['sec-fetch-site'];
      if (typeof fetchSite === 'string' && fetchSite !== 'same-origin') {
        return reply.code(401).send({ error: 'yetkisiz istek' });
      }
    }
  });

  app.get('/', async (_request, reply) => {
    const html = readFileSync(join(d.webFolder, 'index.html'), 'utf-8');
    // Module requests (`<script type="module" src="/js/…">`) carry neither
    // query nor x-token; that is why the token is also handed out as a cookie.
    // `HttpOnly`: the page's own JS never reads this cookie — it takes the
    // token from `location.search` and sends it as `x-token`/`?t=`; the cookie
    // exists only so the browser attaches it to sub-resource requests
    // automatically. `SameSite=Strict`: only cuts the cookie on CROSS-SITE
    // requests — a page on ANOTHER PORT of 127.0.0.1 counts as the SAME SITE
    // as this server (SameSite is per site, not per port), so the cookie goes
    // there too. The guard standing there is the Origin check; but
    // sub-resource requests (`<img>`, `<script>`, `EventSource`) carry no
    // Origin at all — which is why the `onRequest` hook additionally requires
    // `sec-fetch-site: same-origin` when the token came from the cookie (see
    // the comment in that hook). Note: a page on another port can set a more
    // specific cookie like `t=junk; Path=/js` and shadow our `Path=/` cookie —
    // that only hurts usability (our own cookie becomes invisible on that
    // path), it is not an authorization bypass.
    return reply
      .header('set-cookie', `t=${d.token}; Path=/; SameSite=Strict; HttpOnly`)
      .type('text/html; charset=utf-8')
      .send(html);
  });

  app.get('/api/projects', async () => d.store.list());

  app.post('/api/projects', async (request, reply) => {
    const body = (request.body ?? {}) as { name?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name === '') return reply.code(400).send({ error: 'proje adı gerekli' });

    try {
      return reply.code(201).send(d.store.create(name));
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get('/api/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = projectOr404(id, reply);
    return project === null ? reply : project;
  });

  // NOTE: unlike POST /api/projects (wire key `name`), the PUT body is the
  // persisted Project record itself, so its field names are Turkish (`ad`,
  // `ciktiKlasoru`, `satirlar`…). validateProject silently defaults a missing
  // `ad` — a hand-rolled caller sending `name` here would rename the project
  // to "Yeni proje" without an error.
  app.put('/api/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = projectOr404(id, reply);
    if (existing === null) return reply;

    if (isProjectRunning(id)) {
      return reply.code(409).send({ error: 'bu proje çalışıyor; önce durdurun' });
    }
    // An empty body becomes `undefined` in the parser; reject it explicitly,
    // otherwise validateProject would return defaults and wipe the user's project.
    if (request.body === undefined || request.body === null) {
      return reply.code(400).send({ error: 'proje gövdesi gerekli' });
    }

    try {
      // The id in the path wins: a body's id can never overwrite another project.
      return d.store.update(id, request.body);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.delete('/api/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (projectOr404(id, reply) === null) return reply;

    if (isProjectRunning(id)) {
      return reply.code(409).send({ error: 'bu proje çalışıyor; önce durdurun' });
    }

    const query = request.query as { deleteImages?: string };
    const result = d.store.remove(id, query.deleteImages === '1');
    return {
      deleted: result.deleted,
      undeletable: result.undeletable,
      protectedFolder: result.protectedFolder,
    };
  });

  app.post('/api/projects/:id/preview', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (projectOr404(id, reply) === null) return reply;

    const body = (request.body ?? {}) as { basePrompt?: string; rows?: Row[] };
    const basePrompt = body.basePrompt ?? '';
    const rows = Array.isArray(body.rows) ? body.rows : [];
    return {
      hasPlaceholder: hasPlaceholder(basePrompt),
      previews: buildPreviews(basePrompt, rows),
    };
  });

  app.get('/api/projects/:id/gallery', async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = projectOr404(id, reply);
    if (project === null) return reply;

    if (!existsSync(project.ciktiKlasoru)) return { files: [], totalBytes: 0 };

    const files = readdirSync(project.ciktiKlasoru)
      .filter((name) => name.toLowerCase().endsWith('.png'))
      .sort();

    // The delete dialog's "48 images (12.4 MB)" line is fed from here; the client never guesses.
    let totalBytes = 0;
    for (const name of files) {
      try {
        totalBytes += statSync(join(project.ciktiKlasoru, name)).size;
      } catch {
        // the file may have been deleted meanwhile; skip without corrupting the total
      }
    }
    return { files, totalBytes };
  });

  app.get('/api/projects/:id/image/:name', async (request, reply) => {
    const { id, name } = request.params as { id: string; name: string };
    const project = projectOr404(id, reply);
    if (project === null) return reply;

    if (!name.toLowerCase().endsWith('.png')) {
      return reply.code(400).send({ error: 'yalnızca png servis edilir' });
    }

    const folder = project.ciktiKlasoru;
    const requested = join(folder, name);

    // Syntactic check first (cheap, filters crude attempts like `..`)
    if (!isInside(folder, requested)) {
      return reply.code(400).send({ error: 'klasör dışına çıkılamaz' });
    }
    // Then the real check resolving symlinks — `isInside` does not resolve them
    const path = realPathInside(folder, requested);
    if (path === null) return reply.code(404).send({ error: 'görsel bulunamadı' });

    return reply.type('image/png').send(readFileSync(path));
  });

  app.post('/api/projects/:id/open-folder', async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = projectOr404(id, reply);
    if (project === null) return reply;

    mkdirSync(project.ciktiKlasoru, { recursive: true });
    d.openFolder(project.ciktiKlasoru);
    return { opened: true };
  });

  app.get('/api/browser', async () => ({ open: d.isBrowserOpen() }));

  app.post('/api/browser/open', async (_request, reply) => {
    if (d.isBrowserOpen()) return { open: true };
    try {
      await d.openBrowser();
      return { open: d.isBrowserOpen() };
    } catch (error) {
      return reply.code(500).send({ error: (error as Error).message });
    }
  });

  app.get('/api/job', async () => d.jobManager.info());

  // CSV parsing lives in one place: a second parser in the browser would
  // drift over time, and a user's CSV would pass in the browser yet be
  // rejected by the server.
  app.post('/api/csv/parse', async (request, reply) => {
    const body = (request.body ?? {}) as { content?: unknown };
    if (typeof body.content !== 'string') {
      return reply.code(400).send({ error: 'icerik metni gerekli' });
    }
    try {
      return { rows: parseRows(body.content) };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  // Script parsing on the server too: same rationale as CSV — a second copy
  // in the browser drifts over time, and a user's script would pass in the
  // browser yet be rejected by the server.
  app.post('/api/script/parse', async (request, reply) => {
    const body = (request.body ?? {}) as { content?: unknown };
    if (typeof body.content !== 'string') {
      return reply.code(400).send({ error: 'icerik metni gerekli' });
    }
    try {
      return { rows: scriptToRows(body.content) };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post('/api/job/start', async (request, reply) => {
    if (isBusy(d.jobManager)) {
      return reply.code(409).send({ error: 'bir iş zaten çalışıyor' });
    }

    const body = (request.body ?? {}) as { projectId?: unknown };
    if (typeof body.projectId !== 'string') {
      return reply.code(400).send({ error: 'projectId gerekli' });
    }
    const project = projectOr404(body.projectId, reply);
    if (project === null) return reply;

    // No job starts while the browser is closed: the user must get a moment
    // to log in to ChatGPT, otherwise the job starts typing into the chat the
    // instant it opens.
    if (!d.isBrowserOpen()) {
      return reply.code(409).send({ error: 'Önce tarayıcıyı açıp ChatGPT\'ye giriş yapın' });
    }
    if (project.satirlar.length === 0) {
      return reply.code(400).send({ error: 'listede hiç satır yok' });
    }
    if (!hasPlaceholder(project.basePrompt)) {
      return reply.code(400).send({
        error: 'Prompt içinde {VARYASYON} yok — her satır aynı görseli üretirdi',
      });
    }

    d.startJob(project);
    return reply.code(202).send({ started: true });
  });

  for (const [path, action] of [
    ['pause', () => d.jobManager.pause()],
    ['resume', () => d.jobManager.resume()],
    ['stop', () => d.jobManager.stop()],
    ['user-ready', () => d.jobManager.userReady()],
  ] as const) {
    app.post(`/api/job/${path}`, async () => {
      action();
      return d.jobManager.info();
    });
  }

  app.get('/api/job/stream', (request, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const write = (data: unknown) => {
      if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const info = d.jobManager.info();
    write({ type: 'status', status: info.status, projectId: info.projectId, summary: info.summary });

    const unsubscribe = d.jobManager.listen(write);
    request.raw.on('close', () => {
      unsubscribe();
      if (!reply.raw.writableEnded) reply.raw.end();
    });
  });

  // Only /js and /css use this; index.html is already read directly by GET / —
  // adding '.html' would widen the allowlist for nothing.
  const ALLOWED_TYPES: Record<string, string> = {
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
  };

  const serveAsset = (subFolder: string, name: string, reply: FastifyReply) => {
    const extension = name.slice(name.lastIndexOf('.')).toLowerCase();
    const type = ALLOWED_TYPES[extension];
    if (type === undefined) {
      return reply.code(400).send({ error: 'bu dosya türü servis edilmiyor' });
    }

    const root = join(d.webFolder, subFolder);
    const requested = join(root, name);
    // Syntactic check first (cheap, filters crude attempts like `..`)
    if (!isInside(root, requested)) {
      return reply.code(400).send({ error: 'web klasörü dışına çıkılamaz' });
    }
    // Then the real check resolving symlinks — `isInside` does not resolve them
    const path = realPathInside(root, requested);
    if (path === null) return reply.code(404).send({ error: 'dosya bulunamadı' });

    return reply.type(type).send(readFileSync(path, 'utf-8'));
  };

  app.get('/js/:name', async (request, reply) =>
    serveAsset('js', (request.params as { name: string }).name, reply));

  app.get('/css/:name', async (request, reply) =>
    serveAsset('css', (request.params as { name: string }).name, reply));

  app.get('/favicon.ico', async (_request, reply) => reply.code(204).send());

  return app;
}

export function isBusy(jobManager: JobManager): boolean {
  return BUSY_STATUSES.includes(jobManager.info().status);
}
