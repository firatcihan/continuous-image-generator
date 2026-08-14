import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectStore, type Project } from '../src/store/projects.js';
import { JobManager } from '../src/job/jobManager.js';
import { createServer } from '../src/server/index.js';

/**
 * Browsers can send `content-type: application/json` even on bodyless POST
 * requests. By default Fastify rejects an empty body with 400
 * (FST_ERR_CTP_EMPTY_JSON_BODY) — silently breaking every job control button
 * (Start/Pause/Resume/Stop/user-ready/open-folder).
 *
 * These tests mimic what the browser really sends: content-type PRESENT, body ABSENT.
 */

const TOKEN = 'test-token';
const ORIGIN = 'http://127.0.0.1:3000';

let root: string;
let p: Project;
let app: ReturnType<typeof createServer>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bos-govde-'));
  const web = join(root, 'web');
  mkdirSync(web, { recursive: true });
  writeFileSync(join(web, 'index.html'), '<h1>x</h1>', 'utf-8');

  const store = new ProjectStore(root, join(root, 'cikti'));
  p = store.create('Kedi');
  store.write({ ...p, satirlar: [{ metin: 'karda', dosyaAdi: 'kedi_kar' }] });

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

/** The headers a browser fetch produces: content-type present, no body. */
const browserHeaders = () => ({
  'x-token': TOKEN,
  origin: ORIGIN,
  'content-type': 'application/json',
});

describe('bodyless POST + content-type: application/json (browser behavior)', () => {
  const BODYLESS_ROUTES = [
    '/api/job/pause',
    '/api/job/resume',
    '/api/job/stop',
    '/api/job/user-ready',
  ];

  for (const path of BODYLESS_ROUTES) {
    it(`${path} does not reject an empty body with 400`, async () => {
      const response = await app.inject({
        method: 'POST',
        url: path,
        headers: browserHeaders(),
      });
      expect(response.statusCode).not.toBe(400);
      expect(response.statusCode).toBeLessThan(400);
    });
  }

  it('/api/projects/:id/open-folder does not reject an empty body with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${p.id}/open-folder`,
      headers: browserHeaders(),
    });
    expect(response.statusCode).not.toBe(400);
    expect(response.statusCode).toBeLessThan(400);
  });

  it('/api/job/start says projectId is required on a bodyless call', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/job/start',
      headers: browserHeaders(),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/projectId/);
  });

  it('a POST with a body is still parsed normally', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${p.id}/preview`,
      headers: browserHeaders(),
      payload: JSON.stringify({
        basePrompt: 'Bir kedi, {VARYASYON}',
        rows: [{ metin: 'karda', dosyaAdi: 'a' }],
      }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().previews).toEqual(['Bir kedi, karda']);
  });

  it('a malformed JSON body is still rejected with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${p.id}/preview`,
      headers: browserHeaders(),
      payload: '{ bozuk json',
    });
    expect(response.statusCode).toBe(400);
  });

  it('PUT /api/projects/:id returns 400 with an empty body (a body really is required)', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/api/projects/${p.id}`,
      headers: browserHeaders(),
    });
    // An empty body is not a valid project; a validation error is expected, not a parser crash
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBeTruthy();
  });
});
