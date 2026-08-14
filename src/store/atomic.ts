import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

/** File write/fsync operations (optional, for test injection). */
export interface FileOps {
  write: (fd: number, content: string) => void;
  sync: (fd: number) => void;
}

const defaultFileOps: FileOps = {
  write: (fd: number, content: string) => writeSync(fd, content, 0, 'utf-8'),
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
export function atomicWrite(path: string, content: string, ops?: FileOps): void {
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
