import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectStore } from '../src/store/projects.js';
import { JobManager } from '../src/job/jobManager.js';
import { createServer } from '../src/server/index.js';

const TOKEN = 'test-token';
const ORIGIN = 'http://127.0.0.1:3000';

let root: string;
let store: ProjectStore;
let app: ReturnType<typeof createServer>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sunucu-projeler-'));
  const web = join(root, 'web');
  mkdirSync(web, { recursive: true });
  writeFileSync(join(web, 'index.html'), '<h1>merhaba</h1>', 'utf-8');
  store = new ProjectStore(root, join(root, 'cikti'));

  app = createServer({
    store,
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

const authorized = (extra: Record<string, string> = {}) => ({ 'x-token': TOKEN, origin: ORIGIN, ...extra });

describe('GET /', () => {
  it('serves the index.html from the web folder', async () => {
    const r = await app.inject({ method: 'GET', url: `/?t=${TOKEN}` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.body).toContain('merhaba');
  });
});

describe('GET /api/projects', () => {
  it('returns an empty list when there are no projects', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/projects', headers: authorized() });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ projects: [], brokenCount: 0 });
  });

  it('returns the summary fields, does not haul the rows', async () => {
    store.create('Kedi');
    const r = await app.inject({ method: 'GET', url: '/api/projects', headers: authorized() });
    expect(r.json().projects[0].ad).toBe('Kedi');
    expect(r.json().projects[0]).not.toHaveProperty('satirlar');
  });
});

describe('POST /api/projects', () => {
  it('creates a project from a name and returns the full record', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/projects', headers: authorized(), payload: { name: 'Kedi Serisi' },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().id.startsWith('kedi-serisi-')).toBe(true);
    expect(r.json().basePrompt).toContain('{VARYASYON}');
  });

  it('returns 400 for a blank name', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/projects', headers: authorized(), payload: { name: '   ' },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('GET /api/projects/:id', () => {
  it('returns the full record', async () => {
    const p = store.create('Kedi');
    const r = await app.inject({
      method: 'GET', url: `/api/projects/${p.id}`, headers: authorized(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().satirlar).toEqual([]);
  });

  it('returns 404 for an unknown id', async () => {
    const r = await app.inject({
      method: 'GET', url: '/api/projects/yok-1111', headers: authorized(),
    });
    expect(r.statusCode).toBe(404);
  });

  it('returns 404 for an invalid id', async () => {
    const r = await app.inject({
      method: 'GET', url: '/api/projects/BUYUK.HARF', headers: authorized(),
    });
    expect(r.statusCode).toBe(404);
  });
});

describe('PUT /api/projects/:id', () => {
  it('saves and reads back', async () => {
    const p = store.create('Kedi');
    const write = await app.inject({
      method: 'PUT', url: `/api/projects/${p.id}`, headers: authorized(),
      payload: { ...p, ad: 'Kedi 2', satirlar: [{ metin: 'karda', dosyaAdi: 'a' }] },
    });
    expect(write.statusCode).toBe(200);
    expect(store.read(p.id)?.ad).toBe('Kedi 2');
  });

  it('ignores the body\'s id, the path id wins', async () => {
    const p = store.create('Kedi');
    const other = store.create('Plaj');

    await app.inject({
      method: 'PUT', url: `/api/projects/${p.id}`, headers: authorized(),
      payload: { ...p, id: other.id, ad: 'Ezilmeye çalışıldı' },
    });

    expect(store.read(other.id)?.ad).toBe('Plaj');
    expect(store.read(p.id)?.ad).toBe('Ezilmeye çalışıldı');
  });

  it('rejects an invalid body with 400', async () => {
    const p = store.create('Kedi');
    const r = await app.inject({
      method: 'PUT', url: `/api/projects/${p.id}`, headers: authorized(),
      payload: { ...p, satirlar: [{ metin: '', dosyaAdi: 'a' }] },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/boş olamaz/);
  });

  it('rejects an empty body with 400', async () => {
    const p = store.create('Kedi');
    const r = await app.inject({
      method: 'PUT', url: `/api/projects/${p.id}`, headers: authorized(),
    });
    expect(r.statusCode).toBe(400);
  });

  it('rejects another project\'s output folder with 400', async () => {
    const one = store.create('Kedi');
    const two = store.create('Plaj');
    const r = await app.inject({
      method: 'PUT', url: `/api/projects/${two.id}`, headers: authorized(),
      payload: { ...two, ciktiKlasoru: one.ciktiKlasoru },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/Kedi/);
  });
});

describe('DELETE /api/projects/:id', () => {
  it('deletes the record without deleting the images', async () => {
    const p = store.create('Kedi');
    mkdirSync(p.ciktiKlasoru, { recursive: true });
    writeFileSync(join(p.ciktiKlasoru, 'a.png'), 'x');

    const r = await app.inject({
      method: 'DELETE', url: `/api/projects/${p.id}`, headers: authorized(),
    });

    expect(r.statusCode).toBe(200);
    expect(r.json().deleted).toBe(0);
    expect(store.read(p.id)).toBeNull();
    expect(existsSync(join(p.ciktiKlasoru, 'a.png'))).toBe(true);
  });

  it('also deletes the images with deleteImages=1', async () => {
    const p = store.create('Kedi');
    mkdirSync(p.ciktiKlasoru, { recursive: true });
    writeFileSync(join(p.ciktiKlasoru, 'a.png'), 'x');

    const r = await app.inject({
      method: 'DELETE', url: `/api/projects/${p.id}?deleteImages=1`, headers: authorized(),
    });

    expect(r.json()).toEqual({ deleted: 1, undeletable: [], protectedFolder: false });
  });

  it('returns 404 for an unknown id', async () => {
    const r = await app.inject({
      method: 'DELETE', url: '/api/projects/yok-1111', headers: authorized(),
    });
    expect(r.statusCode).toBe(404);
  });
});

describe('POST /api/projects/:id/preview', () => {
  it('returns the rendered form of the first 3 rows', async () => {
    const p = store.create('Kedi');
    const r = await app.inject({
      method: 'POST', url: `/api/projects/${p.id}/preview`, headers: authorized(),
      payload: {
        basePrompt: 'Bir kedi, {VARYASYON}, detaylı',
        rows: [
          { metin: 'karda', dosyaAdi: 'a' }, { metin: 'plajda', dosyaAdi: 'b' },
          { metin: 'ormanda', dosyaAdi: 'c' }, { metin: 'çölde', dosyaAdi: 'd' },
        ],
      },
    });
    expect(r.json().hasPlaceholder).toBe(true);
    expect(r.json().previews).toEqual([
      'Bir kedi, karda, detaylı', 'Bir kedi, plajda, detaylı', 'Bir kedi, ormanda, detaylı',
    ]);
  });

  it('returns hasPlaceholder false and empty previews when the placeholder is missing', async () => {
    const p = store.create('Kedi');
    const r = await app.inject({
      method: 'POST', url: `/api/projects/${p.id}/preview`, headers: authorized(),
      payload: { basePrompt: 'Bir kedi', rows: [{ metin: 'karda', dosyaAdi: 'a' }] },
    });
    expect(r.json().hasPlaceholder).toBe(false);
    expect(r.json().previews).toEqual([]);
  });
});

function runJob(app: ReturnType<typeof createServer>, projectId: string): void {
  void app.testJobManager.start({
    projectId,
    config: {
      basePrompt: 'a {VARYASYON}', ciktiKlasoru: '/tmp', chromeProfil: '/tmp',
      modelAdi: '', satirArasiBekleme: [0, 0], uretimZamanAsimiSn: 1,
      tekrarDenemeSayisi: 1, rateLimitVarsayilanBeklemeDk: 1, esZamanliSekme: 1,
    },
    rows: [{ metin: 'a', dosyaAdi: 'a' }],
    tabs: [{
      openNewChat: async () => {},
      isLoggedIn: async () => true, activeModelName: async () => '',
      generateImage: () => new Promise(() => {}), // hangs
      saveLastImage: async () => {},
    }],
    restartBrowser: async () => {},
    logger: { info: () => {}, warn: () => {}, error: () => {} } as never,
    isCompleted: () => false,
    recordFailure: () => {},
    sleepEngine: async () => {},
  });
}

describe('running project lock', () => {
  it('rejects PUT and DELETE for a running project with 409', async () => {
    const p = store.create('Kedi');
    runJob(app, p.id);
    await new Promise((c) => setTimeout(c, 10));

    const put = await app.inject({
      method: 'PUT', url: `/api/projects/${p.id}`, headers: authorized(), payload: p,
    });
    const del = await app.inject({
      method: 'DELETE', url: `/api/projects/${p.id}`, headers: authorized(),
    });

    expect(put.statusCode).toBe(409);
    expect(del.statusCode).toBe(409);
    app.testJobManager.stop();
  });

  it('allows editing another project that is not running', async () => {
    const running = store.create('Kedi');
    const other = store.create('Plaj');
    runJob(app, running.id);
    await new Promise((c) => setTimeout(c, 10));

    const put = await app.inject({
      method: 'PUT', url: `/api/projects/${other.id}`, headers: authorized(),
      payload: { ...other, ad: 'Plaj 2' },
    });

    expect(put.statusCode).toBe(200);
    app.testJobManager.stop();
  });

  it('rejects starting a new job with 409 while another runs', async () => {
    const running = store.create('Kedi');
    const other = store.create('Plaj');
    runJob(app, running.id);
    await new Promise((c) => setTimeout(c, 10));

    const r = await app.inject({
      method: 'POST', url: '/api/job/start', headers: authorized(), payload: { projectId: other.id },
    });

    expect(r.statusCode).toBe(409);
    app.testJobManager.stop();
  });
});

describe('POST /api/job/start', () => {
  it('returns 400 without a projectId', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/job/start', headers: authorized(), payload: {},
    });
    expect(r.statusCode).toBe(400);
  });

  it('returns 404 for an unknown projectId', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/job/start', headers: authorized(),
      payload: { projectId: 'yok-1111' },
    });
    expect(r.statusCode).toBe(404);
  });

  it('returns 400 when there are no rows', async () => {
    const p = store.create('Kedi');
    const r = await app.inject({
      method: 'POST', url: '/api/job/start', headers: authorized(), payload: { projectId: p.id },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/satır/);
  });

  it('returns 400 when the placeholder is missing', async () => {
    const p = store.create('Kedi');
    store.write({ ...p, basePrompt: 'yer tutucusuz', satirlar: [{ metin: 'a', dosyaAdi: 'a' }] });
    const r = await app.inject({
      method: 'POST', url: '/api/job/start', headers: authorized(), payload: { projectId: p.id },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/VARYASYON/);
  });

  it('returns 202 on a valid project and calls startJob', async () => {
    let started = '';
    const ownApp = createServer({
      store, jobManager: new JobManager(),
      startJob: (project) => { started = project.id; },
      openBrowser: async () => {}, isBrowserOpen: () => true,
      token: TOKEN, allowedOrigin: () => ORIGIN,
      webFolder: join(root, 'web'), openFolder: () => {},
    });
    const p = store.create('Kedi');
    store.write({ ...p, satirlar: [{ metin: 'a', dosyaAdi: 'a' }] });

    const r = await ownApp.inject({
      method: 'POST', url: '/api/job/start', headers: authorized(), payload: { projectId: p.id },
    });

    expect(r.statusCode).toBe(202);
    expect(started).toBe(p.id);
    await ownApp.close();
  });
});

describe('POST /api/csv/parse', () => {
  it('turns CSV text into rows', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/csv/parse', headers: authorized(),
      payload: { content: 'metin,dosya_adi\nkarda,a\n' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().rows).toEqual([{ metin: 'karda', dosyaAdi: 'a' }]);
  });

  it('rejects invalid CSV with 400 and a row-numbered message', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/csv/parse', headers: authorized(),
      payload: { content: 'metin,dosya_adi\na,ayni\nb,ayni\n' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/tekrar/);
  });

  it('returns 400 without content', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/csv/parse', headers: authorized(), payload: {},
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('unexpected file system error', () => {
  it('returns 500 with an { error } body when ciktiKlasoru points at a file', async () => {
    const p = store.create('Kedi');
    const filePath = join(root, 'bu-bir-klasor-degil');
    writeFileSync(filePath, 'x');

    const put = await app.inject({
      method: 'PUT', url: `/api/projects/${p.id}`, headers: authorized(),
      payload: { ...p, ciktiKlasoru: filePath },
    });
    expect(put.statusCode).toBe(200);

    // readdirSync throws ENOTDIR against a file — no route catches it, it
    // must fall through to the global setErrorHandler.
    const r = await app.inject({
      method: 'GET', url: `/api/projects/${p.id}/gallery`, headers: authorized(),
    });
    expect(r.statusCode).toBe(500);
    expect(typeof r.json().error).toBe('string');
    expect(r.json().error.length).toBeGreaterThan(0);
  });
});
