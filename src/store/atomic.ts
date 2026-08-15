import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

/** File write/fsync operations (optional, for test injection). */
export interface FileOps {
  write: (fd: number, content: string | Uint8Array) => void;
  sync: (fd: number) => void;
}

const defaultFileOps: FileOps = {
  // Everything travels as a Buffer so text and images share ONE code path, and
  // the loop keeps going until every byte has landed: `writeSync` is allowed to
  // write fewer bytes than asked, and ignoring that return value is exactly how
  // a truncated file gets created — the failure this whole module exists to
  // prevent. Multi-megabyte images make it more than theoretical.
  write: (fd: number, content: string | Uint8Array) => {
    const bytes = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
    let written = 0;
    while (written < bytes.length) {
      written += writeSync(fd, bytes, written, bytes.length - written);
    }
  },
  sync: (fd: number) => fsyncSync(fd),
};

/**
 * Writes to a temp file and moves it with rename. rename is atomic; even if a
 * crash lands mid-write the target file is either the old or the new version,
 * never half-written. On write failure the temp file is deleted best-effort.
 *
 * @param path Target file path
 * @param content Content to write
 * @param ops Optional file operations (for tests). Default: real writeSync/fsyncSync
 */
export function atomicWrite(path: string, content: string | Uint8Array, ops?: FileOps): void {
  const _ops = ops || defaultFileOps;

  const folder = dirname(path);
  mkdirSync(folder, { recursive: true });

  const temp = join(folder, `.tmp-${process.pid}-${randomUUID()}-${basename(path)}`);
  const fd = openSync(temp, 'w');
  try {
    _ops.write(fd, content);
    _ops.sync(fd);
  } catch (e) {
    // delete the temp file
    try {
      unlinkSync(temp);
    } catch {
      // best-effort, swallow
    }
    throw e;
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
}
