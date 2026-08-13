import { describe, expect, it } from 'vitest';
import { scriptiSatirlaraCevir } from '../src/script.js';

const ORNEK = '(0:00) Bugün hava durumundan bahsedeceğiz. Öğleden (0:09) sonra sıcaklık'
  + ' yükseldi.\nŞimdi teknoloji, (0:17) yapay zeka araçları. Son olarak (0:23) spordan'
  + ' bahsedelim.';

describe('scriptiSatirlaraCevir', () => {
  it('parçayı BİTİREN damgayla adlandırır, son parçaya _son ekler', () => {
    expect(scriptiSatirlaraCevir(ORNEK)).toEqual([
      { metin: 'Bugün hava durumundan bahsedeceğiz. Öğleden', dosyaAdi: '0_09' },
      { metin: 'sonra sıcaklık yükseldi. Şimdi teknoloji,', dosyaAdi: '0_17' },
      { metin: 'yapay zeka araçları. Son olarak', dosyaAdi: '0_23' },
      { metin: 'spordan bahsedelim.', dosyaAdi: '0_23_son' },
    ]);
  });

  it('köşeli parantez ve saat basamağını tanır', () => {
    expect(scriptiSatirlaraCevir('a [0:09] b (1:02:33) c')).toEqual([
      { metin: 'a', dosyaAdi: '0_09' },
      { metin: 'b', dosyaAdi: '1_02_33' },
      { metin: 'c', dosyaAdi: '1_02_33_son' },
    ]);
  });

  it('çıplak saat ifadesini bölme noktası saymaz', () => {
    expect(scriptiSatirlaraCevir('saat 9:30\'da buluştuk (0:09) sonrası')).toEqual([
      { metin: 'saat 9:30\'da buluştuk', dosyaAdi: '0_09' },
      { metin: 'sonrası', dosyaAdi: '0_09_son' },
    ]);
  });

  it('boş segmenti atlar', () => {
    expect(scriptiSatirlaraCevir('(0:00) (0:09) metin')).toEqual([
      { metin: 'metin', dosyaAdi: '0_09_son' },
    ]);
  });

  it('tekrar eden damgada ikinci adı _2 yapar', () => {
    expect(scriptiSatirlaraCevir('a (0:09) b (0:09) c')).toEqual([
      { metin: 'a', dosyaAdi: '0_09' },
      { metin: 'b', dosyaAdi: '0_09_2' },
      { metin: 'c', dosyaAdi: '0_09_son' },
    ]);
  });

  it('satır sonlarını ve çoklu boşlukları tek boşluğa indirir', () => {
    expect(scriptiSatirlaraCevir('  ilk\n\nsatır   ikinci  (0:09) son ')).toEqual([
      { metin: 'ilk satır ikinci', dosyaAdi: '0_09' },
      { metin: 'son', dosyaAdi: '0_09_son' },
    ]);
  });

  it('damga yoksa hata verir', () => {
    expect(() => scriptiSatirlaraCevir('damgasız metin')).toThrow(/zaman damgası bulunamadı/);
  });

  it('damga var ama metin yoksa hata verir', () => {
    expect(() => scriptiSatirlaraCevir('(0:00) (0:09)  ')).toThrow(/çevrilecek metin yok/);
  });
});
