import {
  mkdirSync, mkdtempSync, rmSync, symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ayniKlasorMu } from '../src/depo/yollar.js';

let kok: string;

beforeEach(() => {
  kok = mkdtempSync(join(tmpdir(), 'yollar-test-'));
});
afterEach(() => rmSync(kok, { recursive: true, force: true }));

describe('ayniKlasorMu', () => {
  it('aynı yol metni için true döner', () => {
    const klasor = join(kok, 'a');
    mkdirSync(klasor);
    expect(ayniKlasorMu(klasor, klasor)).toBe(true);
  });

  it('bir klasöre symlink ile ulaşmak aynı klasör sayılır', () => {
    const gercek = join(kok, 'gercek');
    mkdirSync(gercek);
    const bag = join(kok, 'bag');
    symlinkSync(gercek, bag);

    expect(ayniKlasorMu(gercek, bag)).toBe(true);
    expect(ayniKlasorMu(bag, gercek)).toBe(true);
  });

  it('iki farklı klasör için false döner', () => {
    const a = join(kok, 'a');
    const b = join(kok, 'b');
    mkdirSync(a);
    mkdirSync(b);
    expect(ayniKlasorMu(a, b)).toBe(false);
  });

  it('olmayan bir yol için false döner', () => {
    const a = join(kok, 'a');
    mkdirSync(a);
    expect(ayniKlasorMu(a, join(kok, 'yok'))).toBe(false);
    expect(ayniKlasorMu(join(kok, 'yok-1'), join(kok, 'yok-2'))).toBe(false);
  });
});
