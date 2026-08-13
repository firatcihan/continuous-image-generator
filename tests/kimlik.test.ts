import { describe, expect, it } from 'vitest';
import { idGecerliMi, idUret, slugla } from '../src/depo/kimlik.js';

describe('slugla', () => {
  it('boşlukları tire yapar ve küçültür', () => {
    expect(slugla('Kedi Serisi')).toBe('kedi-serisi');
  });

  it('Türkçe karakterleri ASCII karşılığına çevirir', () => {
    expect(slugla('Şeker Böcüğü İĞÜ')).toBe('seker-bocugu-igu');
  });

  it('noktalama ve tekrarlayan ayırıcıları tek tireye indirir', () => {
    expect(slugla('Ürün  çekimi!!! (v2)')).toBe('urun-cekimi-v2');
  });

  it('baştaki ve sondaki tireleri atar', () => {
    expect(slugla('  --deneme--  ')).toBe('deneme');
  });

  it('slug boş kalırsa "proje" döner', () => {
    expect(slugla('***')).toBe('proje');
    expect(slugla('   ')).toBe('proje');
  });

  it('40 karakteri aşmaz ve sonda tire bırakmaz', () => {
    const slug = slugla('a'.repeat(38) + ' bcdef');
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('idUret', () => {
  it('slug + hex biçiminde id üretir', () => {
    expect(idUret('Kedi Serisi', () => false, () => '9f2a')).toBe('kedi-serisi-9f2a');
  });

  it('id zaten varsa yeni hex dener', () => {
    const hexler = ['aaaa', 'bbbb'];
    const id = idUret('Kedi', (aday) => aday === 'kedi-aaaa', () => hexler.shift() as string);
    expect(id).toBe('kedi-bbbb');
  });

  it('50 denemede benzersiz id bulunamazsa hata verir', () => {
    expect(() => idUret('Kedi', () => true, () => 'aaaa')).toThrow(/benzersiz id/);
  });
});

describe('idGecerliMi', () => {
  it('küçük harf, rakam ve tire kabul eder', () => {
    expect(idGecerliMi('kedi-serisi-9f2a')).toBe(true);
  });

  it('yol ayırıcısı ve nokta içeren id\'yi reddeder', () => {
    // Bu, :id parametresinin dosya yoluna girdiği yerdeki path traversal savunması
    expect(idGecerliMi('../gizli')).toBe(false);
    expect(idGecerliMi('a/b')).toBe(false);
    expect(idGecerliMi('a.b')).toBe(false);
    expect(idGecerliMi('')).toBe(false);
    expect(idGecerliMi('BÜYÜK')).toBe(false);
  });
});
