import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  root = mkdtempSync(join(tmpdir(), 'sunucu-script-'));
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
    allowedOrigin: () => ORIGIN,
    webFolder: web,
    openFolder: () => {},
  });
});

afterEach(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

const authorized = () => ({ 'x-token': TOKEN, origin: ORIGIN });

describe('POST /api/script/parse', () => {
  it('turns the script into rows', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/script/parse', headers: authorized(),
      payload: { content: '(0:00) ilk (0:09) son' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      rows: [
        { metin: 'ilk', dosyaAdi: '0_09' },
        { metin: 'son', dosyaAdi: '0_09_son' },
      ],
    });
  });

  it('returns 400 when content is not a string', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/script/parse', headers: authorized(),
      payload: { content: 42 },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('icerik metni gerekli');
  });

  it('returns 400 with the parser\'s message when there is no stamp', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/script/parse', headers: authorized(),
      payload: { content: 'damgasız' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/zaman damgası bulunamadı/);
  });

  it('returns 401 without a token', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/script/parse',
      payload: { content: '(0:00) a (0:09) b' },
    });
    expect(r.statusCode).toBe(401);
  });
});
