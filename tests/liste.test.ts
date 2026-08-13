import { describe, expect, it } from 'vitest';
import { csvAyristir, dosyaAdiTemizle, satirlariAyristir } from '../src/liste.js';

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

describe('satirlariAyristir', () => {
  it('başlıklı CSV\'yi ayrıştırır', () => {
    expect(satirlariAyristir('metin,dosya_adi\nkarda,a\nplajda,b\n')).toEqual([
      { metin: 'karda', dosyaAdi: 'a' },
      { metin: 'plajda', dosyaAdi: 'b' },
    ]);
  });

  it('başlıksız CSV\'yi de ayrıştırır', () => {
    expect(satirlariAyristir('karda,a\n')).toEqual([{ metin: 'karda', dosyaAdi: 'a' }]);
  });

  it('sütun sırası başlıktan okunur', () => {
    expect(satirlariAyristir('dosya_adi,metin\na,karda\n')).toEqual([
      { metin: 'karda', dosyaAdi: 'a' },
    ]);
  });

  it('tırnaklı alanı ve .png uzantısını doğru ele alır', () => {
    expect(satirlariAyristir('"kedi, karda",dag.png\n')).toEqual([
      { metin: 'kedi, karda', dosyaAdi: 'dag' },
    ]);
  });

  it('boş alanı ve tekrar eden dosya adını satır numarasıyla reddeder', () => {
    expect(() => satirlariAyristir('metin,dosya_adi\n,bos\n')).toThrow('2. satır');
    expect(() => satirlariAyristir('metin,dosya_adi\na,ayni\nb,ayni\n')).toThrow('tekrar');
  });

  it('boş metin için boş liste döner', () => {
    expect(satirlariAyristir('')).toEqual([]);
  });

  it('ilk hücresi tam olarak "metin" olan bir veri satırını başlık sanmaz', () => {
    expect(satirlariAyristir('metin,a\n')).toEqual([{ metin: 'metin', dosyaAdi: 'a' }]);
  });

  it('başlık iki sütun adını da içermiyorsa veri satırı sayılır', () => {
    // "dosyaadi" (alt çizgisiz) yazım hatası kasıtlı olarak yakalanmıyor:
    // bunu ayırt etmenin tek yolu tahmin etmek, ve yanlış bir tahmin
    // yukarıdaki gibi tamamen geçerli bir veri satırını reddeder.
    expect(satirlariAyristir('metin,dosyaadi\nkarda,a\n')).toEqual([
      { metin: 'metin', dosyaAdi: 'dosyaadi' },
      { metin: 'karda', dosyaAdi: 'a' },
    ]);
  });
});
