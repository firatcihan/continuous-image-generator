import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectStore, type Project } from '../src/store/projects.js';
import { JobManager } from '../src/job/jobManager.js';
import { createServer } from '../src/server/index.js';

const TOKEN = 'test-token';
const ORIGIN = 'http://127.0.0.1:3000';
const authorized = () => ({ 'x-token': TOKEN, origin: ORIGIN });

let root: string;
let store: ProjectStore;
let p: Project;
let app: ReturnType<typeof createServer>;
let startedProjects: string[];
let jobManager: JobManager;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sunucu-is-'));
  const web = join(root, 'web');
  mkdirSync(web, { recursive: true });
  writeFileSync(join(web, 'index.html'), '<h1>x</h1>', 'utf-8');

  startedProjects = [];
  jobManager = new JobManager();

  store = new ProjectStore(root, join(root, 'cikti'));
  p = store.create('Kedi');
  store.write({ ...p, satirlar: [{ metin: 'karda', dosyaAdi: 'kedi_kar' }] });

  app = createServer({
    store,
    jobManager,
    startJob: (project) => startedProjects.push(project.ad),
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

describe('GET /api/job', () => {
  it('returns the current status', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/job', headers: authorized() });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('idle');
  });

  it('returns the done and inFlight fields', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/job', headers: authorized() });
    expect(r.json().done).toBe(0);
    expect(r.json().inFlight).toEqual([]);
  });
});

describe('POST /api/job/start', () => {
  it('reads the project and fires the startJob callback', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/job/start', headers: authorized(), payload: { projectId: p.id },
    });
    expect(r.statusCode).toBe(202);
    expect(startedProjects).toHaveLength(1);
  });

  it('returns 400 with an empty row list and starts no job', async () => {
    store.write({ ...p, satirlar: [] });
    const r = await app.inject({
      method: 'POST', url: '/api/job/start', headers: authorized(), payload: { projectId: p.id },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/satır/i);
    expect(startedProjects).toHaveLength(0);
  });

  it('returns 400 when the base prompt lacks the placeholder and starts no job', async () => {
    store.write({
      ...p,
      basePrompt: 'Bir kedi',
      satirlar: [{ metin: 'karda', dosyaAdi: 'a' }],
    });
    const r = await app.inject({
      method: 'POST', url: '/api/job/start', headers: authorized(), payload: { projectId: p.id },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/VARYASYON/);
    expect(startedProjects).toHaveLength(0);
  });
});

describe('job control routes', () => {
  it('pause, resume, stop and user-ready are forwarded to the manager', async () => {
    const pause = vi.spyOn(jobManager, 'pause');
    const resume = vi.spyOn(jobManager, 'resume');
    const stop = vi.spyOn(jobManager, 'stop');
    const ready = vi.spyOn(jobManager, 'userReady');

    for (const path of ['pause', 'resume', 'stop', 'user-ready']) {
      const r = await app.inject({
        method: 'POST',
        url: `/api/job/${path}`,
        headers: authorized(),
      });
      expect(r.statusCode).toBe(200);
    }

    expect(pause).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(ready).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
});

describe('GET /api/job/stream (SSE)', () => {
  it('responds with SSE headers and sends the current status on open', async () => {
    const server = await app.listen({ port: 0, host: '127.0.0.1' });
    const response = await fetch(`${server}/api/job/stream?t=${TOKEN}`);

    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('data: ');
    expect(JSON.parse(text.replace(/^data: /, '').trim()).type).toBe('status');

    await reader.cancel();
  });

  it('unhooks the listener when the connection closes', async () => {
    const server = await app.listen({ port: 0, host: '127.0.0.1' });
    const response = await fetch(`${server}/api/job/stream?t=${TOKEN}`);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();

    await new Promise((c) => setTimeout(c, 50));
    // with the listener unhooked, the broadcast reaches no one and throws nothing
    expect(() => jobManager.stop()).not.toThrow();
  });
});
