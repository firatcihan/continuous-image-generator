import { describe, expect, it } from 'vitest';
import { parseCsv, sanitizeFileName, parseRows } from '../src/list.js';

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b\nc,d\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('supports commas and double quotes in quoted fields', () => {
    expect(parseCsv('"kedi, karda","dosya ""1"""\n')).toEqual([['kedi, karda', 'dosya "1"']]);
  });

  it('tolerates CRLF and blank lines', () => {
    expect(parseCsv('a,b\r\n\r\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });
});

describe('sanitizeFileName', () => {
  it('strips the extension and forbidden characters', () => {
    expect(sanitizeFileName(' dag/evi:kis.png ')).toBe('dag_evi_kis');
  });
});

describe('parseRows', () => {
  it('parses CSV with a header', () => {
    expect(parseRows('metin,dosya_adi\nkarda,a\nplajda,b\n')).toEqual([
      { metin: 'karda', dosyaAdi: 'a' },
      { metin: 'plajda', dosyaAdi: 'b' },
    ]);
  });

  it('parses header-less CSV too', () => {
    expect(parseRows('karda,a\n')).toEqual([{ metin: 'karda', dosyaAdi: 'a' }]);
  });

  it('reads the column order from the header', () => {
    expect(parseRows('dosya_adi,metin\na,karda\n')).toEqual([
      { metin: 'karda', dosyaAdi: 'a' },
    ]);
  });

  it('handles a quoted field and the .png extension correctly', () => {
    expect(parseRows('"kedi, karda",dag.png\n')).toEqual([
      { metin: 'kedi, karda', dosyaAdi: 'dag' },
    ]);
  });

  it('rejects an empty field and a duplicate file name with the row number', () => {
    expect(() => parseRows('metin,dosya_adi\n,bos\n')).toThrow('2. satır');
    expect(() => parseRows('metin,dosya_adi\na,ayni\nb,ayni\n')).toThrow('tekrar');
  });

  it('returns an empty list for empty text', () => {
    expect(parseRows('')).toEqual([]);
  });

  it('does not mistake a data row whose first cell is exactly "metin" for a header', () => {
    expect(parseRows('metin,a\n')).toEqual([{ metin: 'metin', dosyaAdi: 'a' }]);
  });

  it('counts the line as data when the header lacks either column name', () => {
    // The "dosyaadi" (no underscore) typo is deliberately not caught: the
    // only way to tell would be guessing, and a wrong guess rejects a
    // perfectly valid data row like the one above.
    expect(parseRows('metin,dosyaadi\nkarda,a\n')).toEqual([
      { metin: 'metin', dosyaAdi: 'dosyaadi' },
      { metin: 'karda', dosyaAdi: 'a' },
    ]);
  });
});
