import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { klasorGorselleriniSil } from '../src/depo/gorselSil.js';

let kok: string;
let klasor: string;

beforeEach(() => {
  kok = mkdtempSync(join(tmpdir(), 'gorsel-sil-'));
  klasor = join(kok, 'kedi-serisi');
  mkdirSync(klasor, { recursive: true });
});
afterEach(() => rmSync(kok, { recursive: true, force: true }));

describe('klasorGorselleriniSil', () => {
  it('yalnızca png dosyalarını siler, diğerlerine dokunmaz', () => {
    writeFileSync(join(klasor, 'a.png'), 'x');
    writeFileSync(join(klasor, 'b.PNG'), 'x');
    writeFileSync(join(klasor, 'basarisizlar.csv'), 'x');
    writeFileSync(join(klasor, 'notlar.txt'), 'x');

    const sonuc = klasorGorselleriniSil(klasor, []);

    expect(sonuc.silinen).toBe(2);
    expect(sonuc.silinemeyen).toEqual([]);
    expect(existsSync(join(klasor, 'basarisizlar.csv'))).toBe(true);
    expect(existsSync(join(klasor, 'notlar.txt'))).toBe(true);
  });

  it('alt klasöre inmez', () => {
    const alt = join(klasor, 'secilenler');
    mkdirSync(alt);
    writeFileSync(join(alt, 'a.png'), 'x');
    writeFileSync(join(klasor, 'b.png'), 'x');

    const sonuc = klasorGorselleriniSil(klasor, []);

    expect(sonuc.silinen).toBe(1);
    expect(existsSync(join(alt, 'a.png'))).toBe(true);
  });

  it('symlink\'in kendisini siler, hedef dosyaya dokunmaz', () => {
    const hedef = join(kok, 'disarida.png');
    writeFileSync(hedef, 'x');
    symlinkSync(hedef, join(klasor, 'bag.png'));

    const sonuc = klasorGorselleriniSil(klasor, []);

    expect(sonuc.silinen).toBe(1);
    expect(existsSync(join(klasor, 'bag.png'))).toBe(false);
    expect(existsSync(hedef)).toBe(true);
  });

  it('klasör boş kaldıysa klasörü de siler', () => {
    writeFileSync(join(klasor, 'a.png'), 'x');

    klasorGorselleriniSil(klasor, []);

    expect(existsSync(klasor)).toBe(false);
  });

  it('klasörde başka dosya kaldıysa klasörü silmez', () => {
    writeFileSync(join(klasor, 'a.png'), 'x');
    writeFileSync(join(klasor, 'notlar.txt'), 'x');

    klasorGorselleriniSil(klasor, []);

    expect(existsSync(klasor)).toBe(true);
  });

  it('korumalı klasörü reddeder ve hiçbir şey silmez', () => {
    writeFileSync(join(klasor, 'a.png'), 'x');

    const sonuc = klasorGorselleriniSil(klasor, [klasor]);

    expect(sonuc).toEqual({ silinen: 0, silinemeyen: [], korumaliKlasor: true });
    expect(existsSync(join(klasor, 'a.png'))).toBe(true);
  });

  it('bir dosya silinemezse diğerlerine devam eder ve raporlar', () => {
    writeFileSync(join(klasor, 'a.png'), 'x');
    writeFileSync(join(klasor, 'b.png'), 'x');

    const sonuc = klasorGorselleriniSil(klasor, [], {
      dosyaSil: (yol) => {
        if (yol.endsWith('a.png')) throw new Error('EACCES');
        rmSync(yol);
      },
      klasorSil: () => {},
    });

    expect(sonuc.silinen).toBe(1);
    expect(sonuc.silinemeyen).toEqual(['a.png']);
  });

  it('klasör yoksa sıfır sonuç döner', () => {
    const sonuc = klasorGorselleriniSil(join(kok, 'yok'), []);
    expect(sonuc).toEqual({ silinen: 0, silinemeyen: [], korumaliKlasor: false });
  });

  it('klasörü silememek sonucu bozmaz', () => {
    writeFileSync(join(klasor, 'a.png'), 'x');

    const sonuc = klasorGorselleriniSil(klasor, [], {
      dosyaSil: (yol) => rmSync(yol),
      klasorSil: () => { throw new Error('EACCES'); },
    });

    expect(sonuc.silinen).toBe(1);
    expect(readdirSync(klasor)).toEqual([]);
  });
});
