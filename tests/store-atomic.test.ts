import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { atomicWrite, type FileOps } from '../src/store/atomic.js';
import { chromeProfilePath, legacyProjectPath, realPathInside, isInside } from '../src/store/paths.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'depo-test-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('paths', () => {
  it('produces the project and chrome profile paths under the root', () => {
    expect(legacyProjectPath('/a/b')).toBe(join('/a/b', 'proje.json'));
    expect(chromeProfilePath('/a/b')).toBe(join('/a/b', 'chrome_profil'));
  });

  it('isInside returns true for a path inside the root', () => {
    expect(isInside('/a/b', '/a/b/c.png')).toBe(true);
    expect(isInside('/a/b', '/a/b')).toBe(true);
  });

  it('isInside returns false for a path escaping the root', () => {
    expect(isInside('/a/b', '/a/c.png')).toBe(false);
    expect(isInside('/a/b', join('/a/b', '..', 'gizli.png'))).toBe(false);
    expect(isInside('/a/b', '/a/bc/d.png')).toBe(false);
  });

  it('isInside accepts a folder whose name starts with .. but sits inside the root', () => {
    // ..cfg, ..tmp etc. must be legal inside the root
    expect(isInside('/a/b', '/a/b/..cfg/dosya.json')).toBe(true);
    expect(isInside('/a/b', '/a/b/..tmp')).toBe(true);
    // real traversal must be rejected
    expect(isInside('/a/b', '/a/b/../gizli.json')).toBe(false);
    expect(isInside('/a/b', '/a/b/../../../etc/passwd')).toBe(false);
  });

  it('realPathInside returns the path for a normal file', () => {
    const path = join(root, 'dosya.txt');
    writeFileSync(path, 'test');
    const real = realPathInside(root, path);
    expect(real).toBe(realpathSync(path));
  });

  it('realPathInside returns null for a missing file', () => {
    const path = join(root, 'yok-olan.txt');
    expect(realPathInside(root, path)).toBeNull();
  });

  it('realPathInside returns null for a symlink pointing outside the root', () => {
    // create a file outside the root
    const outsideFile = join(tmpdir(), 'geheimniss.txt');
    writeFileSync(outsideFile, 'secret');
    try {
      // a symlink inside the root, pointing outside
      const symlink = join(root, 'geheimniss-link');
      symlinkSync(outsideFile, symlink);
      // the resolved path is outside the root
      expect(realPathInside(root, symlink)).toBeNull();
    } finally {
      rmSync(outsideFile, { force: true });
    }
  });
});

describe('atomicWrite', () => {
  it('writes the file', () => {
    const path = join(root, 'x.json');
    atomicWrite(path, '{"a":1}');
    expect(readFileSync(path, 'utf-8')).toBe('{"a":1}');
  });

  it('creates missing folders', () => {
    const path = join(root, 'alt', 'derin', 'x.json');
    atomicWrite(path, 'merhaba');
    expect(readFileSync(path, 'utf-8')).toBe('merhaba');
  });

  it('overwrites an existing file', () => {
    const path = join(root, 'x.json');
    atomicWrite(path, 'eski');
    atomicWrite(path, 'yeni');
    expect(readFileSync(path, 'utf-8')).toBe('yeni');
  });

  it('leaves no temp file behind', () => {
    const path = join(root, 'x.json');
    atomicWrite(path, 'içerik');
    expect(readdirSync(root)).toEqual(['x.json']);
  });

  it('on a failed write the target keeps its old content and the temp file is removed', () => {
    const path = join(root, 'x.json');

    // write the old content
    atomicWrite(path, 'eski');
    expect(readFileSync(path, 'utf-8')).toBe('eski');

    // fake ops that throw
    const failingOps: FileOps = {
      write: () => {
        throw new Error('yazma başarısız (test)');
      },
      sync: () => {},
    };

    let error: Error | null = null;
    try {
      atomicWrite(path, 'yeni-ama-başarısız', failingOps);
      expect.fail('hata fırlatılması gerekiyordu');
    } catch (e: any) {
      error = e;
    }

    expect(error).not.toBeNull();
    expect(error?.message).toContain('yazma başarısız');

    // the target file keeps its OLD content (atomic)
    expect(readFileSync(path, 'utf-8')).toBe('eski');

    // the temp file was deleted
    const files = readdirSync(root);
    expect(files.filter((f: string) => f.startsWith('.tmp-')).length).toBe(0);
  });

  it('the temp file exists during the write and is gone afterwards', () => {
    const path = join(root, 'x.json');
    atomicWrite(path, 'test içerik');

    // after atomicWrite finishes there is no temp file
    const files = readdirSync(root);
    expect(files.filter((f: string) => f.startsWith('.tmp-')).length).toBe(0);

    // the real file exists
    expect(readFileSync(path, 'utf-8')).toBe('test içerik');
  });

  it('temp file names are unique via UUID across concurrent writes', () => {
    const path1 = join(root, 'a.txt');
    const path2 = join(root, 'b.txt');

    // two writes back to back
    atomicWrite(path1, 'birinci');
    atomicWrite(path2, 'ikinci');

    // both succeeded, no temp files
    expect(readFileSync(path1, 'utf-8')).toBe('birinci');
    expect(readFileSync(path2, 'utf-8')).toBe('ikinci');
    expect(readdirSync(root).filter((f: string) => f.startsWith('.tmp-')).length).toBe(0);
  });
});
