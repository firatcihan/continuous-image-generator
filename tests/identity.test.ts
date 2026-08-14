import { describe, expect, it } from 'vitest';
import { isValidId, generateId, slugify } from '../src/store/identity.js';

describe('slugify', () => {
  it('turns spaces into dashes and lowercases', () => {
    expect(slugify('Kedi Serisi')).toBe('kedi-serisi');
  });

  it('maps Turkish characters to their ASCII counterparts', () => {
    expect(slugify('Şeker Böcüğü İĞÜ')).toBe('seker-bocugu-igu');
  });

  it('collapses punctuation and repeated separators into a single dash', () => {
    expect(slugify('Ürün  çekimi!!! (v2)')).toBe('urun-cekimi-v2');
  });

  it('drops leading and trailing dashes', () => {
    expect(slugify('  --deneme--  ')).toBe('deneme');
  });

  it('returns "proje" when the slug ends up empty', () => {
    expect(slugify('***')).toBe('proje');
    expect(slugify('   ')).toBe('proje');
  });

  it('never exceeds 40 characters and never ends with a dash', () => {
    const slug = slugify('a'.repeat(38) + ' bcdef');
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('generateId', () => {
  it('generates an id shaped slug + hex', () => {
    expect(generateId('Kedi Serisi', () => false, () => '9f2a')).toBe('kedi-serisi-9f2a');
  });

  it('tries a fresh hex when the id already exists', () => {
    const hexes = ['aaaa', 'bbbb'];
    const id = generateId('Kedi', (candidate) => candidate === 'kedi-aaaa', () => hexes.shift() as string);
    expect(id).toBe('kedi-bbbb');
  });

  it('throws when no unique id is found in 50 attempts', () => {
    expect(() => generateId('Kedi', () => true, () => 'aaaa')).toThrow(/benzersiz id/);
  });
});

describe('isValidId', () => {
  it('accepts lowercase letters, digits and dashes', () => {
    expect(isValidId('kedi-serisi-9f2a')).toBe(true);
  });

  it('rejects ids containing path separators or dots', () => {
    // The path traversal defense where the :id parameter enters a file path
    expect(isValidId('../gizli')).toBe(false);
    expect(isValidId('a/b')).toBe(false);
    expect(isValidId('a.b')).toBe(false);
    expect(isValidId('')).toBe(false);
    expect(isValidId('BÜYÜK')).toBe(false);
  });
});
