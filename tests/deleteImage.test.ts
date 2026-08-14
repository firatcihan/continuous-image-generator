import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteFolderImages } from '../src/store/deleteImage.js';

let root: string;
let folder: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gorsel-sil-'));
  folder = join(root, 'kedi-serisi');
  mkdirSync(folder, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('deleteFolderImages', () => {
  it('deletes only png files, touches nothing else', () => {
    writeFileSync(join(folder, 'a.png'), 'x');
    writeFileSync(join(folder, 'b.PNG'), 'x');
    writeFileSync(join(folder, 'basarisizlar.csv'), 'x');
    writeFileSync(join(folder, 'notlar.txt'), 'x');

    const result = deleteFolderImages(folder, []);

    expect(result.deleted).toBe(2);
    expect(result.undeletable).toEqual([]);
    expect(existsSync(join(folder, 'basarisizlar.csv'))).toBe(true);
    expect(existsSync(join(folder, 'notlar.txt'))).toBe(true);
  });

  it('does not descend into subfolders', () => {
    const sub = join(folder, 'secilenler');
    mkdirSync(sub);
    writeFileSync(join(sub, 'a.png'), 'x');
    writeFileSync(join(folder, 'b.png'), 'x');

    const result = deleteFolderImages(folder, []);

    expect(result.deleted).toBe(1);
    expect(existsSync(join(sub, 'a.png'))).toBe(true);
  });

  it('deletes the symlink itself, leaves the target file alone', () => {
    const target = join(root, 'disarida.png');
    writeFileSync(target, 'x');
    symlinkSync(target, join(folder, 'bag.png'));

    const result = deleteFolderImages(folder, []);

    expect(result.deleted).toBe(1);
    expect(existsSync(join(folder, 'bag.png'))).toBe(false);
    expect(existsSync(target)).toBe(true);
  });

  it('also removes the folder when it ends up empty', () => {
    writeFileSync(join(folder, 'a.png'), 'x');

    deleteFolderImages(folder, []);

    expect(existsSync(folder)).toBe(false);
  });

  it('keeps the folder when other files remain', () => {
    writeFileSync(join(folder, 'a.png'), 'x');
    writeFileSync(join(folder, 'notlar.txt'), 'x');

    deleteFolderImages(folder, []);

    expect(existsSync(folder)).toBe(true);
  });

  it('refuses a protected folder and deletes nothing', () => {
    writeFileSync(join(folder, 'a.png'), 'x');

    const result = deleteFolderImages(folder, [folder]);

    expect(result).toEqual({ deleted: 0, undeletable: [], protectedFolder: true });
    expect(existsSync(join(folder, 'a.png'))).toBe(true);
  });

  it('also refuses a protected root path with a trailing /', () => {
    writeFileSync(join(folder, 'a.png'), 'x');

    const result = deleteFolderImages(folder, [`${folder}/`]);

    expect(result).toEqual({ deleted: 0, undeletable: [], protectedFolder: true });
    expect(existsSync(join(folder, 'a.png'))).toBe(true);
  });

  it('also refuses a protected root path containing a dot segment', () => {
    writeFileSync(join(folder, 'a.png'), 'x');

    const result = deleteFolderImages(folder, [join(folder, '.')]);

    expect(result).toEqual({ deleted: 0, undeletable: [], protectedFolder: true });
    expect(existsSync(join(folder, 'a.png'))).toBe(true);
  });

  it('also refuses a protected root reaching the folder through a symlink', () => {
    writeFileSync(join(folder, 'a.png'), 'x');
    const link = join(root, 'kok-bagi');
    symlinkSync(folder, link);

    const result = deleteFolderImages(folder, [link]);

    expect(result).toEqual({ deleted: 0, undeletable: [], protectedFolder: true });
    expect(existsSync(join(folder, 'a.png'))).toBe(true);
  });

  it('continues past an undeletable file and reports it', () => {
    writeFileSync(join(folder, 'a.png'), 'x');
    writeFileSync(join(folder, 'b.png'), 'x');

    const result = deleteFolderImages(folder, [], {
      deleteFile: (path) => {
        if (path.endsWith('a.png')) throw new Error('EACCES');
        rmSync(path);
      },
      deleteFolder: () => {},
    });

    expect(result.deleted).toBe(1);
    expect(result.undeletable).toEqual(['a.png']);
  });

  it('returns a zero result when the folder does not exist', () => {
    const result = deleteFolderImages(join(root, 'yok'), []);
    expect(result).toEqual({ deleted: 0, undeletable: [], protectedFolder: false });
  });

  it('failing to remove the folder does not corrupt the result', () => {
    writeFileSync(join(folder, 'a.png'), 'x');

    const result = deleteFolderImages(folder, [], {
      deleteFile: (path) => rmSync(path),
      deleteFolder: () => { throw new Error('EACCES'); },
    });

    expect(result.deleted).toBe(1);
    expect(readdirSync(folder)).toEqual([]);
  });
});
