import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectStore, type Project } from '../src/store/projects.js';
import { JobManager } from '../src/job/jobManager.js';
import { createServer } from '../src/server/index.js';

/**
 * An unauthorized request SEEING 401 is not enough — the route handler must
 * never RUN. In Fastify, if an async onRequest hook calls `reply.send()`
 * without returning the value, the request lifecycle does not stop and the
 * handler still runs: the attacker sees 401 yet a job starts, a project gets
 * overwritten, a folder opens.
 */

const TOKEN = 'test-token';
const ORIGIN = 'http://127.0.0.1:3000';

let root: string;
let p: Project;
let app: ReturnType<typeof createServer>;
let sideEffects: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'yetki-yan-etki-'));
  const web = join(root, 'web');
  mkdirSync(web, { recursive: true });
  writeFileSync(join(web, 'index.html'), '<h1>x</h1>', 'utf-8');

  sideEffects = [];

  const store = new ProjectStore(root, join(root, 'cikti'));
  p = store.create('Korunan proje');
  store.write({ ...p, satirlar: [{ metin: 'karda', dosyaAdi: 'kedi_kar' }] });

  app = createServer({
    store,
    jobManager: new JobManager(),
    startJob: () => { sideEffects.push('is-baslatildi'); },
    openBrowser: async () => {
      sideEffects.push('tarayici-acildi');
    },
    isBrowserOpen: () => true,
    token: TOKEN,
    allowedOrigin: () => ORIGIN,
    webFolder: web,
    openFolder: () => sideEffects.push('klasor-acildi'),
  });
});

afterEach(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

/** The request a malicious site could send: no token. */
const unauthorized = () => ({ origin: 'https://kotu-site.com' });

describe('an unauthorized request must produce no side effect', () => {
  it('POST /api/job/start starts no job', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/job/start', headers: unauthorized() });
    expect(r.statusCode).toBe(401);
    expect(sideEffects).toEqual([]);
  });

  it('POST /api/browser/open opens no browser', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/browser/open', headers: unauthorized() });
    expect(r.statusCode).toBe(401);
    expect(sideEffects).toEqual([]);
  });

  it('POST /api/projects/:id/open-folder opens no folder', async () => {
    const r = await app.inject({
      method: 'POST', url: `/api/projects/${p.id}/open-folder`, headers: unauthorized(),
    });
    expect(r.statusCode).toBe(401);
    expect(sideEffects).toEqual([]);
  });

  it('PUT /api/projects/:id does NOT modify the project', async () => {
    const r = await app.inject({
      method: 'PUT',
      url: `/api/projects/${p.id}`,
      headers: { ...unauthorized(), 'content-type': 'application/json' },
      payload: JSON.stringify({ ...p, ad: 'SALDIRGAN' }),
    });
    expect(r.statusCode).toBe(401);
    expect(new ProjectStore(root, join(root, 'cikti')).read(p.id)?.ad).toBe('Korunan proje');
  });

  it('an unauthorized request gets the 401 body, not the route body', async () => {
    const r = await app.inject({
      method: 'GET', url: `/api/projects/${p.id}`, headers: unauthorized(),
    });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ error: 'yetkisiz istek' });
  });

  it('DELETE /api/projects/:id deletes neither the record nor the images', async () => {
    mkdirSync(p.ciktiKlasoru, { recursive: true });
    writeFileSync(join(p.ciktiKlasoru, 'kedi_kar.png'), 'x');

    const r = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${p.id}?deleteImages=1`,
      headers: unauthorized(),
    });

    expect(r.statusCode).toBe(401);
    expect(new ProjectStore(root, join(root, 'cikti')).read(p.id)).not.toBeNull();
    expect(existsSync(join(p.ciktiKlasoru, 'kedi_kar.png'))).toBe(true);
  });
});
