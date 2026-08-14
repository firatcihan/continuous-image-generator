import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recordFailure, outputPath, isCompleted } from '../src/status.js';

describe('outputPath', () => {
  it('joins folder + file name + .png', () => {
    expect(outputPath('/cikti', 'kedi')).toBe(join('/cikti', 'kedi.png'));
  });
});

describe('isCompleted', () => {
  it('returns true when the PNG exists, false when not', () => {
    const folder = mkdtempSync(join(tmpdir(), 'cikti-'));
    writeFileSync(join(folder, 'var.png'), 'x');
    expect(isCompleted(folder, 'var')).toBe(true);
    expect(isCompleted(folder, 'yok')).toBe(false);
  });
});

describe('recordFailure', () => {
  it('adds the header on first write, writes fields CSV-safely', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'fail-')), 'basarisizlar.csv');
    recordFailure(file, { metin: 'kar, tipi', dosyaAdi: 'dag' }, 'içerik "reddi"');
    recordFailure(file, { metin: 'plaj', dosyaAdi: 'plaj' }, 'zaman aşımı');

    const lines = readFileSync(file, 'utf-8').trim().split('\n');
    // Header is the user-facing CSV contract — stays Turkish.
    expect(lines[0]).toBe('dosya_adi,metin,sebep');
    expect(lines[1]).toBe('"dag","kar, tipi","içerik ""reddi"""');
    expect(lines[2]).toBe('"plaj","plaj","zaman aşımı"');
  });
});
