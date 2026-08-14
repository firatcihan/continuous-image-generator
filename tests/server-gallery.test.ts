import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectStore, type Project } from '../src/store/projects.js';
import { JobManager } from '../src/job/jobManager.js';
import { createServer } from '../src/server/index.js';
import { folderCommand, urlCommand } from '../src/server/folder.js';

const TOKEN = 'test-token';
const ORIGIN = 'http://127.0.0.1:3000';
const authorized = () => ({ 'x-token': TOKEN, origin: ORIGIN });

// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let root: string;
let p: Project;
let openedPaths: string[];
let app: ReturnType<typeof createServer>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'galeri-test-'));
  const web = join(root, 'web');
  mkdirSync(web, { recursive: true });
  writeFileSync(join(web, 'index.html'), '<h1>x</h1>', 'utf-8');

  const store = new ProjectStore(root, join(root, 'cikti'));
  p = store.create('Kedi');
  mkdirSync(p.ciktiKlasoru, { recursive: true });

  writeFileSync(join(p.ciktiKlasoru, 'kedi_kar.png'), PNG);
  writeFileSync(join(p.ciktiKlasoru, 'kedi_plaj.png'), PNG);
  writeFileSync(join(p.ciktiKlasoru, 'notlar.txt'), 'png değil', 'utf-8');
  writeFileSync(join(root, 'gizli.png'), PNG);

  openedPaths = [];
  app = createServer({
    store,
    jobManager: new JobManager(),
    startJob: () => {},
    openBrowser: async () => {},
    isBrowserOpen: () => true,
    token: TOKEN,
    allowedOrigin: () => ORIGIN,
    webFolder: web,
    openFolder: (path) => openedPaths.push(path),
  });
});

afterEach(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe('folderCommand', () => {
  it('produces open -R for macOS', () => {
    expect(folderCommand('darwin', '/a/b')).toEqual({ command: 'open', args: ['-R', '/a/b'] });
  });
  it('produces explorer for Windows', () => {
    expect(folderCommand('win32', 'C:\\a')).toEqual({ command: 'explorer', args: ['C:\\a'] });
  });
  it('produces xdg-open for Linux', () => {
    expect(folderCommand('linux', '/a/b')).toEqual({ command: 'xdg-open', args: ['/a/b'] });
  });
  it('never embeds the path in a shell string (returns an argument array)', () => {
    const { args } = folderCommand('darwin', '/a/b; rm -rf /');
    expect(args.at(-1)).toBe('/a/b; rm -rf /');
  });
});

describe('urlCommand', () => {
  it('uses open for macOS, NOT -R (-R reveals in Finder, opens no browser)', () => {
    expect(urlCommand('darwin', 'http://127.0.0.1:3000/?t=x')).toEqual({
      command: 'open',
      args: ['http://127.0.0.1:3000/?t=x'],
    });
  });
  it('produces cmd /c start for Windows (with the empty title argument)', () => {
    expect(urlCommand('win32', 'http://a')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '', 'http://a'],
    });
  });
  it('produces xdg-open for Linux', () => {
    expect(urlCommand('linux', 'http://a')).toEqual({ command: 'xdg-open', args: ['http://a'] });
  });
});

describe('GET /api/projects/:id/gallery', () => {
  it('lists only png files, sorted', async () => {
    const r = await app.inject({
      method: 'GET', url: `/api/projects/${p.id}/gallery`, headers: authorized(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().files).toEqual(['kedi_kar.png', 'kedi_plaj.png']);
  });

  it('returns an empty list when the output folder is missing', async () => {
    rmSync(p.ciktiKlasoru, { recursive: true, force: true });
    const r = await app.inject({
      method: 'GET', url: `/api/projects/${p.id}/gallery`, headers: authorized(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().files).toEqual([]);
  });

  it('totalBytes returns the sum of file sizes', async () => {
    const r = await app.inject({
      method: 'GET', url: `/api/projects/${p.id}/gallery`, headers: authorized(),
    });
    expect(r.json().totalBytes).toBe(PNG.length * 2);
  });
});

describe('GET /api/projects/:id/image/:name', () => {
  it('serves the png file with the correct content-type', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/api/projects/${p.id}/image/kedi_kar.png`,
      headers: authorized(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('image/png');
    expect(r.rawPayload.length).toBe(PNG.length);
  });

  it('returns 404 for a missing file', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/api/projects/${p.id}/image/yok.png`,
      headers: authorized(),
    });
    expect(r.statusCode).toBe(404);
  });

  it('rejects a non-png file', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/api/projects/${p.id}/image/notlar.txt`,
      headers: authorized(),
    });
    expect(r.statusCode).toBe(400);
  });

  it('rejects escaping the folder via path traversal', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/api/projects/${p.id}/image/..%2Fgizli.png`,
      headers: authorized(),
    });
    expect([400, 404]).toContain(r.statusCode);
  });

  it('rejects leaking outside via a symlink in the output folder', async () => {
    // a link passing the syntactic check but really pointing outside the root
    symlinkSync(join(root, 'gizli.png'), join(p.ciktiKlasoru, 'tuzak.png'));
    const r = await app.inject({
      method: 'GET',
      url: `/api/projects/${p.id}/image/tuzak.png`,
      headers: authorized(),
    });
    expect(r.statusCode).toBe(404);
  });
});

describe('POST /api/projects/:id/open-folder', () => {
  it('opens the project\'s output folder', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/api/projects/${p.id}/open-folder`,
      headers: authorized(),
    });
    expect(r.statusCode).toBe(200);
    expect(openedPaths).toEqual([p.ciktiKlasoru]);
  });
});
