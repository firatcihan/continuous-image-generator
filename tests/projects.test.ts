import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../src/store/projects.js';
import {
  ProjectStore, DEFAULT_SETTINGS, validateProject, configFromProject, newProject,
} from '../src/store/projects.js';

let root: string;
let outputRoot: string;
let store: ProjectStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'projeler-test-'));
  outputRoot = join(root, 'cikti');
  store = new ProjectStore(root, outputRoot);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('newProject', () => {
  it('comes with default settings, an empty list and the slug folder', () => {
    const p = newProject('kedi-serisi-9f2a', 'Kedi Serisi', outputRoot);
    expect(p.ayarlar).toEqual(DEFAULT_SETTINGS);
    expect(p.satirlar).toEqual([]);
    expect(p.basePrompt).toContain('{VARYASYON}');
    expect(p.ciktiKlasoru).toBe(join(outputRoot, 'kedi-serisi'));
  });
});

describe('validateProject', () => {
  it('rejects an invalid id', () => {
    expect(() => validateProject({ id: '../gizli' }, outputRoot)).toThrow(/id/);
    expect(() => validateProject({}, outputRoot)).toThrow(/id/);
  });

  it('fills missing fields with defaults', () => {
    const p = validateProject({ id: 'a-1111', basePrompt: 'X {VARYASYON}' }, outputRoot);
    expect(p.basePrompt).toBe('X {VARYASYON}');
    expect(p.ayarlar).toEqual(DEFAULT_SETTINGS);
    expect(p.ad).toBe('Yeni proje');
  });

  it('trims rows and normalizes the file name', () => {
    const p = validateProject(
      { id: 'a-1111', satirlar: [{ metin: '  karda ', dosyaAdi: 'kedi kar.png' }] },
      outputRoot,
    );
    expect(p.satirlar).toEqual([{ metin: 'karda', dosyaAdi: 'kedi kar' }]);
  });

  it('rejects empty text, a duplicate file name and a broken setting', () => {
    const id = 'a-1111';
    expect(() => validateProject({ id, satirlar: [{ metin: '', dosyaAdi: 'a' }] }, outputRoot))
      .toThrow(/boş olamaz/);
    expect(() => validateProject(
      { id, satirlar: [{ metin: 'a', dosyaAdi: 'x' }, { metin: 'b', dosyaAdi: 'x' }] },
      outputRoot,
    )).toThrow(/tekrar/);
    expect(() => validateProject({ id, ayarlar: { satirArasiBekleme: [9, 2] } }, outputRoot))
      .toThrow(/satirArasiBekleme/);
    expect(() => validateProject({ id, ayarlar: { tekrarDenemeSayisi: 0 } }, outputRoot))
      .toThrow(/tekrarDenemeSayisi/);
    expect(() => validateProject({ id, ciktiKlasoru: '   ' }, outputRoot)).toThrow(/ciktiKlasoru/);
  });

  it('keeps unknown fields from leaking into the settings', () => {
    const p = validateProject(
      { id: 'a-1111', ayarlar: { modelAdi: 'y', junkField: 'x', nested: { a: 1 } } },
      outputRoot,
    );
    expect(p.ayarlar).toEqual({ ...DEFAULT_SETTINGS, modelAdi: 'y' });
    expect(Object.keys(p.ayarlar).sort()).toEqual([
      'esZamanliSekme', 'modelAdi', 'rateLimitVarsayilanBeklemeDk', 'satirArasiBekleme',
      'tekrarDenemeSayisi', 'uretimZamanAsimiSn',
    ]);
  });
});

describe('configFromProject', () => {
  it('turns the project and chrome profile into a Config', () => {
    const project = newProject('a-1111', 'A', outputRoot);
    const config = configFromProject(project, '/tmp/profil');
    expect(config.basePrompt).toBe(project.basePrompt);
    expect(config.ciktiKlasoru).toBe(project.ciktiKlasoru);
    expect(config.chromeProfil).toBe('/tmp/profil');
    expect(config.tekrarDenemeSayisi).toBe(project.ayarlar.tekrarDenemeSayisi);
  });
});

describe('ProjectStore — create and read', () => {
  it('returns an empty list when there are no projects', () => {
    expect(store.list()).toEqual({ projects: [], brokenCount: 0 });
  });

  it('reads a created project back by id', () => {
    const created = store.create('Kedi Serisi');
    expect(created.id.startsWith('kedi-serisi-')).toBe(true);
    expect(store.read(created.id)?.ad).toBe('Kedi Serisi');
    expect(created.olusturmaTarihi).not.toBe('');
  });

  it('sorts the list by name and fills the summary fields', () => {
    store.create('Zebra');
    const cat = store.create('Kedi');
    store.write({ ...store.read(cat.id) as Project, satirlar: [{ metin: 'a', dosyaAdi: 'a' }] });

    const list = store.list();
    expect(list.projects.map((p) => p.ad)).toEqual(['Kedi', 'Zebra']);
    expect(list.projects[0].satirSayisi).toBe(1);
    expect(list.projects[0].ciktiKlasoru).toBe(join(outputRoot, 'kedi'));
  });

  it('gives a second project with the same name a distinct id and folder', () => {
    const one = store.create('Kedi');
    const two = store.create('Kedi');
    expect(two.id).not.toBe(one.id);
    expect(two.ciktiKlasoru).not.toBe(one.ciktiKlasoru);
  });

  it('returns null for an invalid id without touching the file system', () => {
    expect(store.read('../gizli')).toBeNull();
    expect(store.read('yok-1111')).toBeNull();
  });
});

describe('ProjectStore — write', () => {
  it('stamps guncellemeTarihi', () => {
    const p = store.create('Kedi');
    const written = store.write({ ...p, guncellemeTarihi: '' });
    expect(written.guncellemeTarihi).not.toBe('');
  });

  it('refuses to use another project\'s output folder', () => {
    const one = store.create('Kedi');
    const two = store.create('Plaj');

    expect(() => store.write({ ...two, ciktiKlasoru: one.ciktiKlasoru }))
      .toThrow(/Kedi/);
  });

  it('allows a project to rewrite its own folder', () => {
    const p = store.create('Kedi');
    expect(() => store.write({ ...p, ad: 'Kedi 2' })).not.toThrow();
  });
});

describe('ProjectStore — update', () => {
  it('ignores the body\'s id, the parameter id wins', () => {
    const one = store.create('Kedi');
    const two = store.create('Plaj');

    store.update(two.id, { ...(store.read(two.id) as Project), id: one.id, ad: 'Değişti' });

    expect(store.read(two.id)?.ad).toBe('Değişti');
    expect(store.read(one.id)?.ad).toBe('Kedi');
  });

  it('rejects a body failing validation', () => {
    const p = store.create('Kedi');
    expect(() => store.update(p.id, { ...(store.read(p.id) as Project), ciktiKlasoru: '   ' }))
      .toThrow(/ciktiKlasoru/);
  });

  it('rejects a body using another project\'s output folder', () => {
    const one = store.create('Kedi');
    const two = store.create('Plaj');

    expect(() => store.update(two.id, { ...(store.read(two.id) as Project), ciktiKlasoru: one.ciktiKlasoru }))
      .toThrow(/Kedi/);
  });
});

describe('ProjectStore — broken file', () => {
  it('moves the broken file to .bozuk and reports it in the list as brokenCount', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mkdirSync(join(root, 'projeler'), { recursive: true });
    const path = join(root, 'projeler', 'bozuk-1111.json');
    writeFileSync(path, '{ bozuk json', 'utf-8');

    const list = store.list();

    expect(list.projects).toEqual([]);
    expect(list.brokenCount).toBe(1);
    expect(readFileSync(`${path}.bozuk`, 'utf-8')).toBe('{ bozuk json');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('also marks valid JSON that fails validation as .bozuk', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mkdirSync(join(root, 'projeler'), { recursive: true });
    const path = join(root, 'projeler', 'a-1111.json');
    writeFileSync(path, JSON.stringify({ id: 'a-1111', ciktiKlasoru: '  ' }), 'utf-8');

    expect(store.read('a-1111')).toBeNull();
    expect(existsSync(`${path}.bozuk`)).toBe(true);
    errorSpy.mockRestore();
  });
});

describe('ProjectStore — remove', () => {
  it('deletes the record and, when asked, the images too', () => {
    const p = store.create('Kedi');
    mkdirSync(p.ciktiKlasoru, { recursive: true });
    writeFileSync(join(p.ciktiKlasoru, 'a.png'), 'x');

    const result = store.remove(p.id, true);

    expect(result).toEqual({ found: true, deleted: 1, undeletable: [], protectedFolder: false });
    expect(store.read(p.id)).toBeNull();
    expect(existsSync(p.ciktiKlasoru)).toBe(false);
  });

  it('leaves the files alone when deleteImages is false', () => {
    const p = store.create('Kedi');
    mkdirSync(p.ciktiKlasoru, { recursive: true });
    writeFileSync(join(p.ciktiKlasoru, 'a.png'), 'x');

    const result = store.remove(p.id, false);

    expect(result.deleted).toBe(0);
    expect(existsSync(join(p.ciktiKlasoru, 'a.png'))).toBe(true);
    expect(store.read(p.id)).toBeNull();
  });

  it('treats the output root itself as protected, still deletes the record', () => {
    const p = store.create('Kedi');
    mkdirSync(outputRoot, { recursive: true });
    writeFileSync(join(outputRoot, 'a.png'), 'x');
    store.write({ ...p, ciktiKlasoru: outputRoot });

    const result = store.remove(p.id, true);

    expect(result.protectedFolder).toBe(true);
    expect(result.deleted).toBe(0);
    expect(existsSync(join(outputRoot, 'a.png'))).toBe(true);
    expect(store.read(p.id)).toBeNull();
  });

  it('returns found false for a missing project', () => {
    expect(store.remove('yok-1111', true).found).toBe(false);
  });
});

describe('ProjectStore — migration', () => {
  it('moves the old proje.json under projeler/ and leaves a .tasindi behind', () => {
    const legacy = join(root, 'proje.json');
    writeFileSync(legacy, JSON.stringify({
      ad: 'Eski Proje',
      basePrompt: 'Bir kedi, {VARYASYON}',
      ciktiKlasoru: join(outputRoot, 'eski'),
      satirlar: [{ metin: 'a', dosyaAdi: 'a' }],
    }), 'utf-8');

    expect(store.migrate()).toBe(true);

    const list = store.list();
    expect(list.projects).toHaveLength(1);
    expect(list.projects[0].ad).toBe('Eski Proje');
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(`${legacy}.tasindi`)).toBe(true);
  });

  it('returns false when there is no old file', () => {
    expect(store.migrate()).toBe(false);
  });

  it('the second of two calls does nothing', () => {
    writeFileSync(join(root, 'proje.json'), JSON.stringify({ ad: 'A' }), 'utf-8');
    store.migrate();
    expect(store.migrate()).toBe(false);
    expect(store.list().projects).toHaveLength(1);
  });

  it('marks a broken old file .bozuk, returns false and produces no project', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    writeFileSync(join(root, 'proje.json'), '{ bozuk', 'utf-8');

    expect(store.migrate()).toBe(false);
    expect(store.list().projects).toEqual([]);
    expect(existsSync(join(root, 'proje.json.bozuk'))).toBe(true);
    errorSpy.mockRestore();
  });
});

describe('the esZamanliSekme setting', () => {
  const base = { id: 'p1', ad: 'Proje' };

  it('returns 1 when the field is absent (the migration path for old project files)', () => {
    const project = validateProject({ ...base, ayarlar: {} }, outputRoot);
    expect(project.ayarlar.esZamanliSekme).toBe(1);
  });

  it('keeps a valid value', () => {
    const project = validateProject({ ...base, ayarlar: { esZamanliSekme: 3 } }, outputRoot);
    expect(project.ayarlar.esZamanliSekme).toBe(3);
  });

  it('rejects out-of-range and non-integer values', () => {
    for (const invalid of [0, 5, 2.5, -1, '3']) {
      expect(() =>
        validateProject({ ...base, ayarlar: { esZamanliSekme: invalid } }, outputRoot),
      ).toThrow('esZamanliSekme 1 ile 4 arasında tam sayı olmalı');
    }
  });

  it('configFromProject carries the field into Config', () => {
    const project = validateProject({ ...base, ayarlar: { esZamanliSekme: 2 } }, outputRoot);
    expect(configFromProject(project, '/tmp/profil').esZamanliSekme).toBe(2);
  });
});

describe('the script field', () => {
  it('writes and reads back', () => {
    const project = store.create('Kedi');
    expect(project.script).toBe('');

    store.write({ ...project, script: '(0:00) merhaba (0:09) dünya' });
    expect(store.read(project.id)?.script).toBe('(0:00) merhaba (0:09) dünya');
  });

  it('reads an old file without a script field as an empty string', () => {
    const project = store.create('Kedi');

    const path = join(root, 'projeler', `${project.id}.json`);
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    delete raw.script;
    writeFileSync(path, JSON.stringify(raw), 'utf-8');

    expect(store.read(project.id)?.script).toBe('');
  });
});
