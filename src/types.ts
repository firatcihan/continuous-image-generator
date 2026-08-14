/**
 * NOTE ON FIELD NAMES: `Config`, `Row` and the project record types keep their
 * Turkish field names on purpose — they are the persisted schema of the
 * per-project JSON files. Renaming them would orphan every existing user's
 * data. Type names, function names and everything that never reaches disk are
 * English.
 */
export interface Config {
  basePrompt: string;
  ciktiKlasoru: string;
  chromeProfil: string;
  /** Model check is skipped when empty. */
  modelAdi: string;
  /** [min, max] seconds. */
  satirArasiBekleme: [number, number];
  uretimZamanAsimiSn: number;
  tekrarDenemeSayisi: number;
  rateLimitVarsayilanBeklemeDk: number;
  /** Concurrent tab count, 1-4. 1 = sequential. */
  esZamanliSekme: number;
}

export interface Row {
  metin: string;
  dosyaAdi: string;
}

export type ImageResult =
  | { type: 'image' }
  | { type: 'rateLimit'; message: string }
  | { type: 'refusal'; message: string }
  /** ChatGPT's transient/generic error ("Something went wrong"). Retried after a short wait. */
  | { type: 'transientError'; message: string }
  | { type: 'timeout' };

/** The Chromium context — shared by all tabs. */
export interface GenerationBrowser {
  launch(): Promise<void>;
  relaunch(): Promise<void>;
  /** Tops the tab count up to n and returns handles for all of them. */
  prepareTabs(n: number): Promise<GenerationTab[]>;
  close(): Promise<void>;
}

/** A single tab — owned by exactly one worker, never shared. */
export interface GenerationTab {
  openNewChat(): Promise<void>;
  isLoggedIn(): Promise<boolean>;
  activeModelName(): Promise<string>;
  generateImage(prompt: string, timeoutSec: number): Promise<ImageResult>;
  saveLastImage(targetPath: string): Promise<void>;
}

export interface RunSummary {
  succeeded: number;
  skipped: number;
  failed: number;
}
