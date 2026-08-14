import { describe, expect, it } from 'vitest';
import { scriptToRows } from '../src/script.js';

const SAMPLE = '(0:00) Bugün hava durumundan bahsedeceğiz. Öğleden (0:09) sonra sıcaklık'
  + ' yükseldi.\nŞimdi teknoloji, (0:17) yapay zeka araçları. Son olarak (0:23) spordan'
  + ' bahsedelim.';

describe('scriptToRows', () => {
  it('names each piece after the stamp that ENDS it, suffixes the last piece with _son', () => {
    expect(scriptToRows(SAMPLE)).toEqual([
      { metin: 'Bugün hava durumundan bahsedeceğiz. Öğleden', dosyaAdi: '0_09' },
      { metin: 'sonra sıcaklık yükseldi. Şimdi teknoloji,', dosyaAdi: '0_17' },
      { metin: 'yapay zeka araçları. Son olarak', dosyaAdi: '0_23' },
      { metin: 'spordan bahsedelim.', dosyaAdi: '0_23_son' },
    ]);
  });

  it('recognizes square brackets and an hour digit', () => {
    expect(scriptToRows('a [0:09] b (1:02:33) c')).toEqual([
      { metin: 'a', dosyaAdi: '0_09' },
      { metin: 'b', dosyaAdi: '1_02_33' },
      { metin: 'c', dosyaAdi: '1_02_33_son' },
    ]);
  });

  it('does not treat a bare clock time as a split point', () => {
    expect(scriptToRows('saat 9:30\'da buluştuk (0:09) sonrası')).toEqual([
      { metin: 'saat 9:30\'da buluştuk', dosyaAdi: '0_09' },
      { metin: 'sonrası', dosyaAdi: '0_09_son' },
    ]);
  });

  it('skips an empty segment', () => {
    expect(scriptToRows('(0:00) (0:09) metin')).toEqual([
      { metin: 'metin', dosyaAdi: '0_09_son' },
    ]);
  });

  it('names the second occurrence of a repeated stamp _2', () => {
    expect(scriptToRows('a (0:09) b (0:09) c')).toEqual([
      { metin: 'a', dosyaAdi: '0_09' },
      { metin: 'b', dosyaAdi: '0_09_2' },
      { metin: 'c', dosyaAdi: '0_09_son' },
    ]);
  });

  it('collapses line breaks and multiple spaces into single spaces', () => {
    expect(scriptToRows('  ilk\n\nsatır   ikinci  (0:09) son ')).toEqual([
      { metin: 'ilk satır ikinci', dosyaAdi: '0_09' },
      { metin: 'son', dosyaAdi: '0_09_son' },
    ]);
  });

  it('throws when there is no stamp', () => {
    expect(() => scriptToRows('damgasız metin')).toThrow(/zaman damgası bulunamadı/);
  });

  it('throws when there are stamps but no text', () => {
    expect(() => scriptToRows('(0:00) (0:09)  ')).toThrow(/çevrilecek metin yok/);
  });
});
