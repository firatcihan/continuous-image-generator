import { describe, expect, it } from 'vitest';
import { promptOlustur, YER_TUTUCU, onizlemeUret, yerTutucuVarMi } from '../src/prompt.js';
import type { Satir } from '../src/tipler.js';

describe('promptOlustur', () => {
  it('{VARYASYON} yer tutucusunu metinle değiştirir', () => {
    expect(promptOlustur('Bir kedi, {VARYASYON}, detaylı', 'karda')).toBe('Bir kedi, karda, detaylı');
  });

  it('birden çok {VARYASYON} geçtiyse hepsini değiştirir', () => {
    expect(promptOlustur('{VARYASYON} ve {VARYASYON}', 'x')).toBe('x ve x');
  });

  it('yer tutucu yoksa hata fırlatır', () => {
    expect(() => promptOlustur('yer tutucu yok', 'x')).toThrow('{VARYASYON}');
  });
});

const SATIRLAR: Satir[] = [
  { metin: 'karda', dosyaAdi: 'a' },
  { metin: 'plajda', dosyaAdi: 'b' },
  { metin: 'ormanda', dosyaAdi: 'c' },
  { metin: 'çölde', dosyaAdi: 'd' },
];

describe('yerTutucuVarMi', () => {
  it('yer tutucu varsa true', () => {
    expect(yerTutucuVarMi(`Bir kedi, ${YER_TUTUCU}`)).toBe(true);
  });
  it('yer tutucu yoksa false', () => {
    expect(yerTutucuVarMi('Bir kedi')).toBe(false);
  });
});

describe('onizlemeUret', () => {
  it('varsayılan olarak ilk 3 satırı render eder', () => {
    const onizleme = onizlemeUret(`Bir kedi, ${YER_TUTUCU}, detaylı`, SATIRLAR);
    expect(onizleme).toEqual([
      'Bir kedi, karda, detaylı',
      'Bir kedi, plajda, detaylı',
      'Bir kedi, ormanda, detaylı',
    ]);
  });

  it('adet parametresine uyar', () => {
    expect(onizlemeUret(`X ${YER_TUTUCU}`, SATIRLAR, 1)).toEqual(['X karda']);
  });

  it('satır sayısı adetten azsa hepsini döner', () => {
    expect(onizlemeUret(`X ${YER_TUTUCU}`, [SATIRLAR[0]])).toEqual(['X karda']);
  });

  it('birden fazla yer tutucunun hepsini değiştirir', () => {
    expect(onizlemeUret(`${YER_TUTUCU} ve ${YER_TUTUCU}`, [SATIRLAR[0]], 1)).toEqual([
      'karda ve karda',
    ]);
  });

  it('yer tutucu yoksa boş dizi döner, fırlatmaz', () => {
    expect(onizlemeUret('Bir kedi', SATIRLAR)).toEqual([]);
  });

  it('satır yoksa boş dizi döner', () => {
    expect(onizlemeUret(`X ${YER_TUTUCU}`, [])).toEqual([]);
  });
});
