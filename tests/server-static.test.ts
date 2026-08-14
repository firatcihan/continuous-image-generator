import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectStore } from '../src/store/projects.js';
import { JobManager } from '../src/job/jobManager.js';
import { createServer } from '../src/server/index.js';

const TOKEN = 'test-token';
const ORIGIN = 'http://127.0.0.1:3000';

let root: string;
let app: ReturnType<typeof createServer>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sunucu-statik-'));
  const web = join(root, 'web');
  mkdirSync(join(web, 'js'), { recursive: true });
  mkdirSync(join(web, 'css'), { recursive: true });
  writeFileSync(join(web, 'index.html'), '<h1>merhaba</h1>', 'utf-8');
  writeFileSync(join(web, 'js', 'api.js'), 'export const x = 1;', 'utf-8');
  writeFileSync(join(web, 'css', 'style.css'), 'body{}', 'utf-8');
  writeFileSync(join(root, 'gizli.txt'), 'sır', 'utf-8');

  app = createServer({
    store: new ProjectStore(root, join(root, 'cikti')),
    jobManager: new JobManager(),
    startJob: () => {},
    openBrowser: async () => {},
    isBrowserOpen: () => true,
    token: TOKEN,
    allowedOrigin: () => ORIGIN,
    webFolder: web,
    openFolder: () => {},
  });
});

afterEach(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe('GET / cookie', () => {
  it('hands out the token as a SameSite=Strict cookie', async () => {
    const r = await app.inject({ method: 'GET', url: `/?t=${TOKEN}` });
    expect(r.statusCode).toBe(200);
    const cookie = String(r.headers['set-cookie']);
    expect(cookie).toContain(`t=${TOKEN}`);
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
  });
});

describe('auth via cookie', () => {
  it('accepts a module request with the cookie', async () => {
    const r = await app.inject({
      method: 'GET', url: '/js/api.js', headers: { cookie: `t=${TOKEN}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/javascript');
    expect(r.body).toContain('export const x');
  });

  it('rejects a cookieless module request with 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/js/api.js' });
    expect(r.statusCode).toBe(401);
  });

  it('rejects a wrong cookie', async () => {
    const r = await app.inject({
      method: 'GET', url: '/js/api.js', headers: { cookie: 't=yanlis' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('also accepts an API request with the cookie', async () => {
    const r = await app.inject({
      method: 'GET', url: '/api/projects', headers: { cookie: `t=${TOKEN}`, origin: ORIGIN },
    });
    expect(r.statusCode).toBe(200);
  });

  // The Origin check must stay in force even with a valid cookie — SameSite
  // only cuts cross-SITE, not cross-PORT (see the comment in the onRequest
  // hook), so we verify separately that the Origin check keeps standing guard.
  it('rejects a foreign Origin even with a valid cookie', async () => {
    const r = await app.inject({
      method: 'GET', url: '/api/projects',
      headers: { cookie: `t=${TOKEN}`, origin: 'http://127.0.0.1:9999' },
    });
    expect(r.statusCode).toBe(401);
  });
});

describe('cookie + sec-fetch-site', () => {
  it('cookie + same-origin is accepted', async () => {
    const r = await app.inject({
      method: 'GET', url: '/js/api.js',
      headers: { cookie: `t=${TOKEN}`, 'sec-fetch-site': 'same-origin' },
    });
    expect(r.statusCode).toBe(200);
  });

  it('cookie + same-site (another port) is rejected', async () => {
    const r = await app.inject({
      method: 'GET', url: '/js/api.js',
      headers: { cookie: `t=${TOKEN}`, 'sec-fetch-site': 'same-site' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('cookie without a sec-fetch-site header is accepted (fail-open)', async () => {
    const r = await app.inject({
      method: 'GET', url: '/js/api.js', headers: { cookie: `t=${TOKEN}` },
    });
    expect(r.statusCode).toBe(200);
  });

  it('the sec-fetch-site restriction never applies to a token from x-token/query', async () => {
    const r = await app.inject({
      method: 'GET', url: '/js/api.js',
      headers: { 'x-token': TOKEN, 'sec-fetch-site': 'same-site' },
    });
    expect(r.statusCode).toBe(200);
  });
});

describe('static assets', () => {
  it('serves css', async () => {
    const r = await app.inject({
      method: 'GET', url: '/css/style.css', headers: { cookie: `t=${TOKEN}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/css');
  });

  it('rejects a request trying to escape the web folder', async () => {
    const r = await app.inject({
      method: 'GET', url: '/js/..%2F..%2Fgizli.txt', headers: { cookie: `t=${TOKEN}` },
    });
    expect(r.statusCode).toBe(400);
    expect(r.body).not.toContain('sır');
  });

  // The test above stops at the extension check (.txt is not allowed) — it
  // would return the same result (400) even with `isInside` and
  // `realPathInside` deleted, so it proves nothing about the first layer
  // actually BLOCKING anything. This test, using an allowed extension (.js)
  // with an encoded `..%2F`, genuinely triggers the first layer (isInside).
  it('cannot escape the folder with an encoded separator even under an allowed extension', async () => {
    writeFileSync(join(root, 'gizli.js'), 'sır', 'utf-8');
    const r = await app.inject({
      method: 'GET', url: '/js/..%2F..%2Fgizli.js', headers: { cookie: `t=${TOKEN}` },
    });
    expect(r.statusCode).toBe(400);
    expect(r.body).not.toContain('sır');
  });

  it('rejects a file outside the allowed extensions', async () => {
    writeFileSync(join(root, 'web', 'js', 'gizli.json'), '{}', 'utf-8');
    const r = await app.inject({
      method: 'GET', url: '/js/gizli.json', headers: { cookie: `t=${TOKEN}` },
    });
    expect(r.statusCode).toBe(400);
  });

  it('returns 404 for a missing file', async () => {
    const r = await app.inject({
      method: 'GET', url: '/js/yok.js', headers: { cookie: `t=${TOKEN}` },
    });
    expect(r.statusCode).toBe(404);
  });

  // The "rejects a file outside the allowed extensions" test stops at the
  // extension check (.json is not allowed anyway) without ever touching the
  // syntactic layer (isInside). So no scenario exercised `isInside` actually
  // BLOCKING anything. This test, planting a symlink escaping the folder
  // under an allowed extension (.js), genuinely triggers the second layer
  // (realPathInside).
  it('rejects a symlink escaping the web folder even under an allowed extension', async () => {
    symlinkSync(join(root, 'gizli.txt'), join(root, 'web', 'js', 'tuzak.js'));
    const r = await app.inject({
      method: 'GET', url: '/js/tuzak.js', headers: { cookie: `t=${TOKEN}` },
    });
    expect(r.statusCode).toBe(404);
    expect(r.body).not.toContain('sır');
  });
});

describe('GET /favicon.ico', () => {
  it('returns 204 even without a token — keeps the browser console clean', async () => {
    const r = await app.inject({ method: 'GET', url: '/favicon.ico' });
    expect(r.statusCode).toBe(204);
  });

  // A prefix check like `request.url.startsWith('/favicon.ico')` would also
  // exempt paths that do not match exactly, like `/favicon.icoX` or
  // `/favicon.ico/../api/projects`, on a real raw socket request (Node's
  // http server does not normalize `..` segments; that is only MASKED by
  // `.inject()`/browser fetch normalization — not in production). Because
  // the exemption is limited to an exact path match, this tokenless request
  // must fall to an explicit 401, not a 404.
  it('the exemption never applies to a path starting with the favicon prefix but not matching exactly', async () => {
    const r = await app.inject({ method: 'GET', url: '/favicon.icoX' });
    expect(r.statusCode).toBe(401);
  });
});
