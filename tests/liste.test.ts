import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { csvAyristir, dosyaAdiTemizle, listeYukle } from '../src/liste.js';

function listeDosyasiYaz(icerik: string): string {
  const yol = join(mkdtempSync(join(tmpdir(), 'liste-')), 'liste.csv');
  writeFileSync(yol, icerik, 'utf-8');
  return yol;
}

describe('csvAyristir', () => {
  it('basit satırları ayrıştırır', () => {
    expect(csvAyristir('a,b\nc,d\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('tırnaklı alanlarda virgül ve çift tırnak destekler', () => {
    expect(csvAyristir('"kedi, karda","dosya ""1"""\n')).toEqual([['kedi, karda', 'dosya "1"']]);
  });

  it('CRLF ve boş satırları tolere eder', () => {
    expect(csvAyristir('a,b\r\n\r\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });
});

describe('dosyaAdiTemizle', () => {
  it('uzantıyı ve yasak karakterleri temizler', () => {
    expect(dosyaAdiTemizle(' dag/evi:kis.png ')).toBe('dag_evi_kis');
  });
});

describe('listeYukle', () => {
  it('başlıklı CSV dosyasını Satir listesine çevirir', () => {
    const yol = listeDosyasiYaz('metin,dosya_adi\nkar yağarken,dag_evi\nplajda,plaj\n');
    expect(listeYukle(yol)).toEqual([
      { metin: 'kar yağarken', dosyaAdi: 'dag_evi' },
      { metin: 'plajda', dosyaAdi: 'plaj' },
    ]);
  });

  it('başlık sütunları eksikse hata fırlatır', () => {
    expect(() => listeYukle(listeDosyasiYaz('a,b\nx,y\n'))).toThrow('metin,dosya_adi');
  });

  it('boş metin veya dosya adı için satır numarasıyla hata fırlatır', () => {
    expect(() => listeYukle(listeDosyasiYaz('metin,dosya_adi\n,bos\n'))).toThrow('2. satır');
  });

  it('tekrar eden dosya adı için hata fırlatır', () => {
    expect(() => listeYukle(listeDosyasiYaz('metin,dosya_adi\na,ayni\nb,ayni\n'))).toThrow('tekrar');
  });
});
