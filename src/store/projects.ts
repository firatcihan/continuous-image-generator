import {
  existsSync, readFileSync, readdirSync, renameSync, rmSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { sanitizeFileName } from '../list.js';
import type { Config, Row } from '../types.js';
import { atomicWrite } from './atomic.js';
import { deleteFolderImages } from './deleteImage.js';
import { isValidId, generateId, slugify } from './identity.js';
import {
  isSameFolder, legacyProjectPath, projectFilePath, projectsDir,
} from './paths.js';

/**
 * FIELD NAMES: `Project`, `ProjectSettings` and `Row` keep their Turkish field
 * names — they are the persisted schema of `projeler/<id>.json` files already
 * on users' disks. Only type/function names are English.
 */
export interface ProjectSettings {
  modelAdi: string;
  satirArasiBekleme: [number, number];
  uretimZamanAsimiSn: number;
  tekrarDenemeSayisi: number;
  rateLimitVarsayilanBeklemeDk: number;
  /** Concurrent tab count, 1-4. 1 = today's sequential behavior. */
  esZamanliSekme: number;
}

export interface Project {
  id: string;
  ad: string;
  basePrompt: string;
  ciktiKlasoru: string;
  satirlar: Row[];
  /**
   * The raw time-stamped script the rows were generated from. Never fed into
   * generation; kept so the user can fix the script and reconvert.
   */
  script: string;
  ayarlar: ProjectSettings;
  olusturmaTarihi: string;
  guncellemeTarihi: string;
}

/** For the left panel: drawing the list without hauling full records. */
export interface ProjectSummary {
  id: string;
  ad: string;
  ciktiKlasoru: string;
  satirSayisi: number;
  guncellemeTarihi: string;
}

export interface ProjectList {
  projects: ProjectSummary[];
  /** Count of files renamed to .bozuk because they could not be read — for the UI warning line. */
  brokenCount: number;
}

export interface DeleteResult {
  found: boolean;
  deleted: number;
  undeletable: string[];
  protectedFolder: boolean;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  modelAdi: '',
  satirArasiBekleme: [5, 15],
  uretimZamanAsimiSn: 180,
  tekrarDenemeSayisi: 3,
  rateLimitVarsayilanBeklemeDk: 15,
  esZamanliSekme: 1,
};

export function newProject(id: string, name: string, outputRoot: string): Project {
  return {
    id,
    ad: name,
    basePrompt: 'Bir kedi, {VARYASYON}, yüksek detaylı',
    ciktiKlasoru: join(outputRoot, slugify(name)),
    satirlar: [],
    script: '',
    ayarlar: { ...DEFAULT_SETTINGS },
    olusturmaTarihi: '',
    guncellemeTarihi: '',
  };
}

export function validateProject(raw: unknown, outputRoot: string): Project {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

  const id = typeof source.id === 'string' ? source.id : '';
  if (!isValidId(id)) {
    throw new Error('id geçersiz (yalnızca küçük harf, rakam ve tire)');
  }

  const name = stringField(source.ad, 'Yeni proje');
  const fallback = newProject(id, name, outputRoot);

  const outputFolder = stringField(source.ciktiKlasoru, fallback.ciktiKlasoru).trim();
  if (outputFolder === '') throw new Error('ciktiKlasoru boş olamaz');

  return {
    id,
    ad: name,
    basePrompt: stringField(source.basePrompt, fallback.basePrompt),
    ciktiKlasoru: outputFolder,
    satirlar: validateRows(source.satirlar),
    // Old project files lack this field; the `stringField` default doubles as migration.
    script: stringField(source.script, ''),
    ayarlar: validateSettings(source.ayarlar),
    olusturmaTarihi: stringField(source.olusturmaTarihi, ''),
    guncellemeTarihi: stringField(source.guncellemeTarihi, ''),
  };
}

export function configFromProject(project: Project, chromeProfile: string): Config {
  return {
    basePrompt: project.basePrompt,
    ciktiKlasoru: project.ciktiKlasoru,
    chromeProfil: chromeProfile,
    modelAdi: project.ayarlar.modelAdi,
    satirArasiBekleme: project.ayarlar.satirArasiBekleme,
    uretimZamanAsimiSn: project.ayarlar.uretimZamanAsimiSn,
    tekrarDenemeSayisi: project.ayarlar.tekrarDenemeSayisi,
    rateLimitVarsayilanBeklemeDk: project.ayarlar.rateLimitVarsayilanBeklemeDk,
    esZamanliSekme: project.ayarlar.esZamanliSekme,
  };
}

function stringField(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function validateRows(raw: unknown): Row[] {
  if (!Array.isArray(raw)) return [];
  const rows: Row[] = [];
  const seen = new Set<string>();

  for (const [index, record] of raw.entries()) {
    const r = (typeof record === 'object' && record !== null ? record : {}) as Record<string, unknown>;
    const metin = typeof r.metin === 'string' ? r.metin.trim() : '';
    const dosyaAdi = sanitizeFileName(typeof r.dosyaAdi === 'string' ? r.dosyaAdi : '');

    if (metin === '' || dosyaAdi === '') {
      throw new Error(`${index + 1}. satır: "metin" ve "dosya_adi" boş olamaz`);
    }
    if (seen.has(dosyaAdi)) {
      throw new Error(`${index + 1}. satır: "${dosyaAdi}" dosya adı tekrar ediyor`);
    }
    seen.add(dosyaAdi);
    rows.push({ metin, dosyaAdi });
  }
  return rows;
}

/**
 * Reads the 6 `ProjectSettings` fields one by one, does NOT spread `source`.
 * Otherwise unknown fields arriving in HTTP bodies would accumulate on disk.
 */
function validateSettings(raw: unknown): ProjectSettings {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

  const rawModelName = source.modelAdi;
  if (rawModelName !== undefined && typeof rawModelName !== 'string') {
    throw new Error('modelAdi metin olmalı');
  }

  return {
    modelAdi: typeof rawModelName === 'string' ? rawModelName : DEFAULT_SETTINGS.modelAdi,
    satirArasiBekleme: validateWaitRange(source.satirArasiBekleme),
    uretimZamanAsimiSn: validatePositiveNumber(source.uretimZamanAsimiSn, 'uretimZamanAsimiSn'),
    tekrarDenemeSayisi: validatePositiveNumber(source.tekrarDenemeSayisi, 'tekrarDenemeSayisi'),
    rateLimitVarsayilanBeklemeDk: validatePositiveNumber(
      source.rateLimitVarsayilanBeklemeDk,
      'rateLimitVarsayilanBeklemeDk',
    ),
    esZamanliSekme: validateTabCount(source.esZamanliSekme),
  };
}

/**
 * Upper bound 4: the ChatGPT image quota is per account, so more tabs bring
 * no speedup — they only grow the automation footprint.
 */
function validateTabCount(raw: unknown): number {
  if (raw === undefined) return DEFAULT_SETTINGS.esZamanliSekme;

  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 4) {
    throw new Error('esZamanliSekme 1 ile 4 arasında tam sayı olmalı');
  }
  return raw;
}

function validateWaitRange(raw: unknown): [number, number] {
  if (raw === undefined) return DEFAULT_SETTINGS.satirArasiBekleme;

  if (
    !Array.isArray(raw) ||
    raw.length !== 2 ||
    raw.some((sec) => typeof sec !== 'number' || !Number.isFinite(sec) || sec < 0) ||
    raw[0] > raw[1]
  ) {
    throw new Error('satirArasiBekleme [min, maks] saniye olmalı (min <= maks)');
  }
  return [raw[0], raw[1]];
}

function validatePositiveNumber(
  raw: unknown,
  field: 'uretimZamanAsimiSn' | 'tekrarDenemeSayisi' | 'rateLimitVarsayilanBeklemeDk',
): number {
  if (raw === undefined) return DEFAULT_SETTINGS[field];

  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    throw new Error(`${field} pozitif bir sayı olmalı`);
  }
  return raw;
}

/** Never overwrites an existing `${path}.<suffix>`; finds the first free `-N` name. */
function uniqueBackupPath(path: string, suffix: string): string {
  const base = `${path}.${suffix}`;
  if (!existsSync(base)) return base;

  let counter = 2;
  while (existsSync(`${base}-${counter}`)) counter++;
  return `${base}-${counter}`;
}

export class ProjectStore {
  constructor(
    private dataRoot: string,
    private outputRoot: string,
  ) {}

  /**
   * Moves Phase 2A's single `proje.json` to `projeler/<id>.json`.
   * The old file is kept as `.tasindi` — not deleted, the migration is reversible.
   * @returns true when a migration happened
   */
  migrate(): boolean {
    const legacy = legacyProjectPath(this.dataRoot);
    if (!existsSync(legacy)) return false;

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(legacy, 'utf-8'));
    } catch (error) {
      const broken = uniqueBackupPath(legacy, 'bozuk');
      console.error(`eski proje.json ayrıştırılamadı, "${broken}" olarak taşınıyor:`, error);
      renameSync(legacy, broken);
      return false;
    }

    const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const name = typeof source.ad === 'string' && source.ad.trim() !== '' ? source.ad : 'Yeni proje';

    try {
      const id = generateId(name, (candidate) => existsSync(projectFilePath(this.dataRoot, candidate)));
      this.write(validateProject({ ...source, id }, this.outputRoot));
    } catch (error) {
      const broken = uniqueBackupPath(legacy, 'bozuk');
      console.error(`eski proje.json doğrulanamadı, "${broken}" olarak taşınıyor:`, error);
      renameSync(legacy, broken);
      return false;
    }

    renameSync(legacy, uniqueBackupPath(legacy, 'tasindi'));
    console.log('proje.json göç etti; eski dosya .tasindi olarak saklandı');
    return true;
  }

  list(): ProjectList {
    const dir = projectsDir(this.dataRoot);
    if (!existsSync(dir)) return { projects: [], brokenCount: 0 };

    const projects: ProjectSummary[] = [];
    let brokenCount = 0;

    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const id = file.slice(0, -'.json'.length);
      if (!isValidId(id)) continue;

      const project = this.read(id);
      if (project === null) {
        brokenCount++;
        continue;
      }
      projects.push({
        id: project.id,
        ad: project.ad,
        ciktiKlasoru: project.ciktiKlasoru,
        satirSayisi: project.satirlar.length,
        guncellemeTarihi: project.guncellemeTarihi,
      });
    }

    // Alphabetical: a "most recently updated first" order would make the list
    // jump around while autosave writes it.
    projects.sort((a, b) => a.ad.localeCompare(b.ad, 'tr'));
    return { projects, brokenCount };
  }

  /** Missing, invalid id or broken file → null. Broken files are renamed `.bozuk`. */
  read(id: string): Project | null {
    if (!isValidId(id)) return null;

    const path = projectFilePath(this.dataRoot, id);
    if (!existsSync(path)) return null;

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (error) {
      return this.markBroken(path, 'ayrıştırılamadı', error);
    }

    try {
      return validateProject(raw, this.outputRoot);
    } catch (error) {
      return this.markBroken(path, 'doğrulanamadı', error);
    }
  }

  create(name: string): Project {
    const cleanName = name.trim() === '' ? 'Yeni proje' : name.trim();
    const id = generateId(cleanName, (candidate) => existsSync(projectFilePath(this.dataRoot, candidate)));

    const draft = newProject(id, cleanName, this.outputRoot);
    // If the slug folder is used by another project, use the id as folder name —
    // otherwise write() would throw a clash error.
    const folder = this.folderOwner(draft.ciktiKlasoru, id) === null
      ? draft.ciktiKlasoru
      : join(this.outputRoot, id);

    return this.write({ ...draft, ciktiKlasoru: folder, olusturmaTarihi: new Date().toISOString() });
  }

  write(project: Project): Project {
    const validated = validateProject(project, this.outputRoot);

    const owner = this.folderOwner(validated.ciktiKlasoru, validated.id);
    if (owner !== null) {
      throw new Error(`"${owner}" projesi bu çıktı klasörünü kullanıyor: ${validated.ciktiKlasoru}`);
    }

    const now = new Date().toISOString();
    const stamped: Project = {
      ...validated,
      olusturmaTarihi: validated.olusturmaTarihi === '' ? now : validated.olusturmaTarihi,
      guncellemeTarihi: now,
    };
    atomicWrite(projectFilePath(this.dataRoot, stamped.id), JSON.stringify(stamped, null, 2));
    return stamped;
  }

  /**
   * Writes an unvalidated record such as an HTTP body. `id` comes from the
   * caller (the route parameter) — the body's `id` is ignored, so one
   * project's body can never overwrite another project.
   */
  update(id: string, raw: unknown): Project {
    const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    return this.write(validateProject({ ...source, id }, this.outputRoot));
  }

  remove(id: string, deleteImages: boolean): DeleteResult {
    const project = this.read(id);
    if (project === null) {
      return { found: false, deleted: 0, undeletable: [], protectedFolder: false };
    }

    const images = deleteImages
      ? deleteFolderImages(project.ciktiKlasoru, [homedir(), this.outputRoot, this.dataRoot])
      : { deleted: 0, undeletable: [], protectedFolder: false };

    rmSync(projectFilePath(this.dataRoot, id), { force: true });
    return { found: true, ...images };
  }

  /**
   * Returns the name of another project using the same output folder, if any.
   * The resume logic is "skip the row when its PNG exists on disk", so two
   * projects sharing a folder would count each other's rows as done. The
   * comparison uses `isSameFolder` from `./paths.js` — plain text equality
   * would miss the clash on case-insensitive file systems.
   */
  private folderOwner(folder: string, excludeId: string): string | null {
    for (const summary of this.list().projects) {
      if (summary.id === excludeId) continue;
      if (isSameFolder(summary.ciktiKlasoru, folder)) return summary.ad;
    }
    return null;
  }

  private markBroken(path: string, reason: string, error: unknown): null {
    const broken = uniqueBackupPath(path, 'bozuk');
    console.error(`proje dosyası ${reason} (${path}), "${broken}" olarak taşınıyor:`, error);
    renameSync(path, broken);
    return null;
  }
}
