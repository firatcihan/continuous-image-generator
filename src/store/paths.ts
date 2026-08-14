import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { realpathSync, statSync } from 'node:fs';

// The Turkish directory names are the on-disk contract of existing installs —
// renaming them would orphan every user's data. Do not translate.
export const DEFAULT_DATA_ROOT = join(homedir(), '.chatgpt-gorsel-uretici');
export const DEFAULT_OUTPUT_ROOT = join(homedir(), 'ChatGPT-Gorseller');

export function projectsDir(dataRoot: string): string {
  return join(dataRoot, 'projeler');
}

export function projectFilePath(dataRoot: string, id: string): string {
  return join(projectsDir(dataRoot), `${id}.json`);
}

/** Phase 2A's single project file — only used for the migration check. */
export function legacyProjectPath(dataRoot: string): string {
  return join(dataRoot, 'proje.json');
}

export function chromeProfilePath(dataRoot: string): string {
  return join(dataRoot, 'chrome_profil');
}

/**
 * Syntactically: does `candidate`, once normalized, stay inside `root`?
 * Path traversal defense. Does not resolve symlinks; for real file access
 * use `realPathInside()`.
 */
export function isInside(root: string, candidate: string): boolean {
  const diff = relative(resolve(root), resolve(candidate));
  if (diff === '') return true;                          // candidate is the root itself
  if (diff === '..' || diff.startsWith('..' + sep)) return false;  // escapes the root
  if (isAbsolute(diff)) return false;                    // different drive (Windows)
  return true;
}

/**
 * For real file access: verifies the candidate stays inside the root after
 * resolving symlinks. Returns null when the candidate does not exist.
 */
export function realPathInside(root: string, candidate: string): string | null {
  try {
    const realCandidate = realpathSync(candidate);
    const realRoot = realpathSync(root);
    if (isInside(realRoot, realCandidate)) {
      return realCandidate;
    }
    return null;
  } catch {
    // candidate does not exist
    return null;
  }
}

/**
 * Whether two paths point at the same folder. Comparing the path text (after
 * resolve) is not enough: on case-insensitive file systems (the macOS and
 * Windows default) `/Users/x` and `/users/x` are the same folder but not equal
 * as text. `realpath` does not fix this either — it resolves symlinks, it does
 * not normalize letter case. So we look at the file system's identity
 * (device + inode). When either folder is missing from disk (an output folder
 * not yet produced, or a protected root that no longer exists) the error is
 * swallowed and false returned — nothing can clash in that case anyway.
 */
export function isSameFolder(a: string, b: string): boolean {
  if (resolve(a) === resolve(b)) return true;
  try {
    const x = statSync(a);
    const y = statSync(b);
    return x.dev === y.dev && x.ino === y.ino;
  } catch {
    return false;
  }
}
