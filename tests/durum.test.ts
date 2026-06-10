import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { basarisizKaydet, ciktiYolu, tamamlandiMi } from '../src/durum.js';

describe('ciktiYolu', () => {
  it('klasör + dosya_adi + .png birleştirir', () => {
    expect(ciktiYolu('/cikti', 'kedi')).toBe(join('/cikti', 'kedi.png'));
  });
});

describe('tamamlandiMi', () => {
  it('PNG varsa true, yoksa false döner', () => {
    const klasor = mkdtempSync(join(tmpdir(), 'cikti-'));
    writeFileSync(join(klasor, 'var.png'), 'x');
    expect(tamamlandiMi(klasor, 'var')).toBe(true);
    expect(tamamlandiMi(klasor, 'yok')).toBe(false);
  });
});

describe('basarisizKaydet', () => {
  it('ilk yazımda başlık ekler, alanları CSV-güvenli yazar', () => {
    const dosya = join(mkdtempSync(join(tmpdir(), 'fail-')), 'basarisizlar.csv');
    basarisizKaydet(dosya, { metin: 'kar, tipi', dosyaAdi: 'dag' }, 'içerik "reddi"');
    basarisizKaydet(dosya, { metin: 'plaj', dosyaAdi: 'plaj' }, 'zaman aşımı');

    const satirlar = readFileSync(dosya, 'utf-8').trim().split('\n');
    expect(satirlar[0]).toBe('dosya_adi,metin,sebep');
    expect(satirlar[1]).toBe('"dag","kar, tipi","içerik ""reddi"""');
    expect(satirlar[2]).toBe('"plaj","plaj","zaman aşımı"');
  });
});
