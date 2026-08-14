import {
  mkdirSync, mkdtempSync, rmSync, symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isSameFolder } from '../src/store/paths.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'yollar-test-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('isSameFolder', () => {
  it('returns true for the identical path text', () => {
    const folder = join(root, 'a');
    mkdirSync(folder);
    expect(isSameFolder(folder, folder)).toBe(true);
  });

  it('reaching a folder through a symlink counts as the same folder', () => {
    const real = join(root, 'gercek');
    mkdirSync(real);
    const link = join(root, 'bag');
    symlinkSync(real, link);

    expect(isSameFolder(real, link)).toBe(true);
    expect(isSameFolder(link, real)).toBe(true);
  });

  it('returns false for two different folders', () => {
    const a = join(root, 'a');
    const b = join(root, 'b');
    mkdirSync(a);
    mkdirSync(b);
    expect(isSameFolder(a, b)).toBe(false);
  });

  it('returns false for a missing path', () => {
    const a = join(root, 'a');
    mkdirSync(a);
    expect(isSameFolder(a, join(root, 'yok'))).toBe(false);
    expect(isSameFolder(join(root, 'yok-1'), join(root, 'yok-2'))).toBe(false);
  });
});
