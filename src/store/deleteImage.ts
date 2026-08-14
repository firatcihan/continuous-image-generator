import {
  existsSync, readdirSync, rmSync, rmdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { isSameFolder, isInside } from './paths.js';

/** Delete operations (for test injection). */
export interface DeleteOps {
  deleteFile: (path: string) => void;
  deleteFolder: (path: string) => void;
}

export interface ImageDeleteResult {
  deleted: number;
  undeletable: string[];
  protectedFolder: boolean;
}

const defaultOps: DeleteOps = {
  deleteFile: (path) => rmSync(path),
  deleteFolder: (path) => rmdirSync(path),
};

/**
 * Deletes the images inside a project's output folder.
 *
 * The constraints are deliberately narrow: a misconfigured `ciktiKlasoru`
 * (e.g. the home directory) must not turn into a disaster.
 * - Only `.png` files directly inside the folder are deleted
 * - No descent into subfolders, no other extension touched
 * - A symlink itself is deleted; `rmSync` does not follow it, so the target survives
 * - If the folder is one of `protectedRoots`, nothing is deleted
 * - After the PNGs are gone the folder is removed if empty, kept if not
 */
export function deleteFolderImages(
  folder: string,
  protectedRoots: string[],
  ops: DeleteOps = defaultOps,
): ImageDeleteResult {
  if (!existsSync(folder)) {
    return { deleted: 0, undeletable: [], protectedFolder: false };
  }

  const target = resolve(folder);
  if (protectedRoots.some((root) => isSameFolder(root, target))) {
    return { deleted: 0, undeletable: [], protectedFolder: true };
  }

  let deleted = 0;
  const undeletable: string[] = [];

  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    if (!entry.name.toLowerCase().endsWith('.png')) continue;

    const path = join(target, entry.name);
    // readdir names cannot escape the folder; the defense layer stays anyway
    if (!isInside(target, path)) continue;

    try {
      ops.deleteFile(path);
      deleted++;
    } catch {
      undeletable.push(entry.name);
    }
  }

  if (readdirSync(target).length === 0) {
    try {
      ops.deleteFolder(target);
    } catch {
      // failing to delete the folder does not change the fact the images are gone
    }
  }

  return { deleted, undeletable, protectedFolder: false };
}
