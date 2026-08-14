import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectStore, type Project } from '../src/store/projects.js';
import { JobManager } from '../src/job/jobManager.js';
import { createServer } from '../src/server/index.js';

/**
 * The browser must open through a separate action BEFORE any job starts, so
 * the user can log in to ChatGPT. Otherwise the job starts typing into the
 * chat the moment Start is pressed and there is no moment left to log in.
 */

const TOKEN = 'test-token';
const ORIGIN = 'http://127.0.0.1:3000';
const authorized = () => ({ 'x-token': TOKEN, origin: ORIGIN });

let root: string;
let p: Project;
let app: ReturnType<typeof createServer>;
let browserOpenCount: number;
let browserOpen: boolean;
let openError: Error | null;
let startedJobs: number;

function setUpServer(): void {
  const web = join(root, 'web');
  mkdirSync(web, { recursive: true });
  writeFileSync(join(web, 'index.html'), '<h1>x</h1>', 'utf-8');

  const store = new ProjectStore(root, join(root, 'cikti'));
  p = store.create('Kedi');
  store.write({ ...p, satirlar: [{ metin: 'karda', dosyaAdi: 'kedi_kar' }] });

  app = createServer({
    store,
    jobManager: new JobManager(),
    startJob: () => {
      startedJobs++;
    },
    openBrowser: async () => {
      browserOpenCount++;
      if (openError) throw openError;
      browserOpen = true;
    },
    isBrowserOpen: () => browserOpen,
    token: TOKEN,
    allowedOrigin: () => ORIGIN,
    webFolder: web,
    openFolder: () => {},
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tarayici-test-'));
  browserOpenCount = 0;
  browserOpen = false;
  openError = null;
  startedJobs = 0;
  setUpServer();
});

afterEach(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe('GET /api/browser', () => {
  it('returns open:false while the browser is closed', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/browser', headers: authorized() });
    expect(r.statusCode).toBe(200);
    expect(r.json().open).toBe(false);
  });

  it('returns open:true after the browser opened', async () => {
    await app.inject({ method: 'POST', url: '/api/browser/open', headers: authorized() });
    const r = await app.inject({ method: 'GET', url: '/api/browser', headers: authorized() });
    expect(r.json().open).toBe(true);
  });
});

describe('POST /api/browser/open', () => {
  it('opens the browser and starts NO job', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/browser/open', headers: authorized() });
    expect(r.statusCode).toBe(200);
    expect(r.json().open).toBe(true);
    expect(browserOpenCount).toBe(1);
    expect(startedJobs).toBe(0);
  });

  it('does not try to open again when already open', async () => {
    await app.inject({ method: 'POST', url: '/api/browser/open', headers: authorized() });
    await app.inject({ method: 'POST', url: '/api/browser/open', headers: authorized() });
    expect(browserOpenCount).toBe(1);
  });

  it('returns 500 with a readable message when opening fails', async () => {
    openError = new Error("Executable doesn't exist — yarn playwright install");
    const r = await app.inject({ method: 'POST', url: '/api/browser/open', headers: authorized() });
    expect(r.statusCode).toBe(500);
    expect(r.json().error).toContain('playwright install');
  });

  it('also works on a bodyless POST + content-type json (browser behavior)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/browser/open',
      headers: { ...authorized(), 'content-type': 'application/json' },
    });
    expect(r.statusCode).toBe(200);
  });
});

describe('POST /api/job/start while the browser is closed', () => {
  it('returns 409 and starts no job — the user must log in first', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/job/start', headers: authorized(), payload: { projectId: p.id },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/tarayıcı/i);
    expect(startedJobs).toBe(0);
  });

  it('the job starts after the browser opened', async () => {
    await app.inject({ method: 'POST', url: '/api/browser/open', headers: authorized() });
    const r = await app.inject({
      method: 'POST', url: '/api/job/start', headers: authorized(), payload: { projectId: p.id },
    });
    expect(r.statusCode).toBe(202);
    expect(startedJobs).toBe(1);
  });
});
