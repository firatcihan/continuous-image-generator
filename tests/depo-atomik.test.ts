import { existsSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atomikYaz, type DosyaIslemleri } from '../src/depo/atomik.js';
import { chromeProfilYolu, gercekYolIcerdeMi, icerdeMi, projeYolu } from '../src/depo/yollar.js';

let kok: string;
beforeEach(() => {
  kok = mkdtempSync(join(tmpdir(), 'depo-test-'));
});
afterEach(() => {
  rmSync(kok, { recursive: true, force: true });
});

describe('yollar', () => {
  it('proje ve chrome profil yollarını kök altında üretir', () => {
    expect(projeYolu('/a/b')).toBe(join('/a/b', 'proje.json'));
    expect(chromeProfilYolu('/a/b')).toBe(join('/a/b', 'chrome_profil'));
  });

  it('icerdeMi kök içindeki yola true döner', () => {
    expect(icerdeMi('/a/b', '/a/b/c.png')).toBe(true);
    expect(icerdeMi('/a/b', '/a/b')).toBe(true);
  });

  it('icerdeMi kök dışına çıkan yola false döner', () => {
    expect(icerdeMi('/a/b', '/a/c.png')).toBe(false);
    expect(icerdeMi('/a/b', join('/a/b', '..', 'gizli.png'))).toBe(false);
    expect(icerdeMi('/a/b', '/a/bc/d.png')).toBe(false);
  });

  it('icerdeMi adı .. ile başlayan ama kök içindeki klasörü kabul eder', () => {
    // ..cfg, ..tmp vb klasörler kök içinde yasal olmalı
    expect(icerdeMi('/a/b', '/a/b/..cfg/dosya.json')).toBe(true);
    expect(icerdeMi('/a/b', '/a/b/..tmp')).toBe(true);
    // gerçek traversal reddedilmeli
    expect(icerdeMi('/a/b', '/a/b/../gizli.json')).toBe(false);
    expect(icerdeMi('/a/b', '/a/b/../../../etc/passwd')).toBe(false);
  });

  it('gercekYolIcerdeMi normal dosya için yolu döner', () => {
    const yol = join(kok, 'dosya.txt');
    writeFileSync(yol, 'test');
    const gercek = gercekYolIcerdeMi(kok, yol);
    expect(gercek).toBe(realpathSync(yol));
  });

  it('gercekYolIcerdeMi olmayan dosya için null döner', () => {
    const yol = join(kok, 'yok-olan.txt');
    expect(gercekYolIcerdeMi(kok, yol)).toBeNull();
  });

  it('gercekYolIcerdeMi kök dışını gösteren symlink için null döner', () => {
    // kök dışında bir dosya oluştur
    const disariaDosya = join(tmpdir(), 'geheimniss.txt');
    writeFileSync(disariaDosya, 'secret');
    try {
      // kok içinde symlink, dışarıyı göster
      const symlink = join(kok, 'geheimniss-link');
      symlinkSync(disariaDosya, symlink);
      // resolved path kök dışında
      expect(gercekYolIcerdeMi(kok, symlink)).toBeNull();
    } finally {
      rmSync(disariaDosya, { force: true });
    }
  });
});

describe('atomikYaz', () => {
  it('dosyayı yazar', () => {
    const yol = join(kok, 'x.json');
    atomikYaz(yol, '{"a":1}');
    expect(readFileSync(yol, 'utf-8')).toBe('{"a":1}');
  });

  it('eksik klasörleri oluşturur', () => {
    const yol = join(kok, 'alt', 'derin', 'x.json');
    atomikYaz(yol, 'merhaba');
    expect(readFileSync(yol, 'utf-8')).toBe('merhaba');
  });

  it('var olan dosyanın üzerine yazar', () => {
    const yol = join(kok, 'x.json');
    atomikYaz(yol, 'eski');
    atomikYaz(yol, 'yeni');
    expect(readFileSync(yol, 'utf-8')).toBe('yeni');
  });

  it('geçici dosya bırakmaz', () => {
    const yol = join(kok, 'x.json');
    atomikYaz(yol, 'içerik');
    expect(readdirSync(kok)).toEqual(['x.json']);
  });

  it('yazma başarısız olursa hedef dosya eski hali kalır, geçici dosya silinir', () => {
    const yol = join(kok, 'x.json');

    // Eski içerik yaz
    atomikYaz(yol, 'eski');
    expect(readFileSync(yol, 'utf-8')).toBe('eski');

    // Hata fırlatan sahte islemler
    const hataIslemleri: DosyaIslemleri = {
      yaz: () => {
        throw new Error('yazma başarısız (test)');
      },
      esitle: () => {},
    };

    let hata: Error | null = null;
    try {
      atomikYaz(yol, 'yeni-ama-başarısız', hataIslemleri);
      expect.fail('hata fırlatılması gerekiyordu');
    } catch (e: any) {
      hata = e;
    }

    expect(hata).not.toBeNull();
    expect(hata?.message).toContain('yazma başarısız');

    // Hedef dosya ESKİ içeriğiyle duruyor (atomik)
    expect(readFileSync(yol, 'utf-8')).toBe('eski');

    // Geçici dosya silinmiş
    const dosyalar = readdirSync(kok);
    expect(dosyalar.filter((d: string) => d.startsWith('.tmp-')).length).toBe(0);
  });

  it('yazma sırasında geçici dosya var ve sonra silinir', () => {
    const yol = join(kok, 'x.json');
    atomikYaz(yol, 'test içerik');

    // atomikYaz bittikten sonra geçici dosya yok
    const dosyalar = readdirSync(kok);
    expect(dosyalar.filter((d: string) => d.startsWith('.tmp-')).length).toBe(0);

    // asıl dosya var
    expect(readFileSync(yol, 'utf-8')).toBe('test içerik');
  });

  it('eşzamanlı yazmalarda geçici dosya adı UUID ile benzersiz', () => {
    const yol1 = join(kok, 'a.txt');
    const yol2 = join(kok, 'b.txt');

    // sırayla iki yazma
    atomikYaz(yol1, 'birinci');
    atomikYaz(yol2, 'ikinci');

    // ikisi de başarılı, geçici dosya yok
    expect(readFileSync(yol1, 'utf-8')).toBe('birinci');
    expect(readFileSync(yol2, 'utf-8')).toBe('ikinci');
    expect(readdirSync(kok).filter((d: string) => d.startsWith('.tmp-')).length).toBe(0);
  });
});
