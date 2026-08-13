import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Proje } from '../src/depo/projeler.js';
import {
  ProjelerDepo, VARSAYILAN_AYARLAR, projeDogrula, projedenConfig, yeniProje,
} from '../src/depo/projeler.js';

let kok: string;
let ciktiKoku: string;
let depo: ProjelerDepo;

beforeEach(() => {
  kok = mkdtempSync(join(tmpdir(), 'projeler-test-'));
  ciktiKoku = join(kok, 'cikti');
  depo = new ProjelerDepo(kok, ciktiKoku);
});
afterEach(() => rmSync(kok, { recursive: true, force: true }));

describe('yeniProje', () => {
  it('varsayılan ayarlarla, boş listeyle ve slug klasörüyle gelir', () => {
    const p = yeniProje('kedi-serisi-9f2a', 'Kedi Serisi', ciktiKoku);
    expect(p.ayarlar).toEqual(VARSAYILAN_AYARLAR);
    expect(p.satirlar).toEqual([]);
    expect(p.basePrompt).toContain('{VARYASYON}');
    expect(p.ciktiKlasoru).toBe(join(ciktiKoku, 'kedi-serisi'));
  });
});

describe('projeDogrula', () => {
  it('geçersiz id\'yi reddeder', () => {
    expect(() => projeDogrula({ id: '../gizli' }, ciktiKoku)).toThrow(/id/);
    expect(() => projeDogrula({}, ciktiKoku)).toThrow(/id/);
  });

  it('eksik alanları varsayılanla doldurur', () => {
    const p = projeDogrula({ id: 'a-1111', basePrompt: 'X {VARYASYON}' }, ciktiKoku);
    expect(p.basePrompt).toBe('X {VARYASYON}');
    expect(p.ayarlar).toEqual(VARSAYILAN_AYARLAR);
    expect(p.ad).toBe('Yeni proje');
  });

  it('satırları temizler ve dosya adını normalize eder', () => {
    const p = projeDogrula(
      { id: 'a-1111', satirlar: [{ metin: '  karda ', dosyaAdi: 'kedi kar.png' }] },
      ciktiKoku,
    );
    expect(p.satirlar).toEqual([{ metin: 'karda', dosyaAdi: 'kedi kar' }]);
  });

  it('boş metin, tekrar eden dosya adı ve bozuk ayarı reddeder', () => {
    const id = 'a-1111';
    expect(() => projeDogrula({ id, satirlar: [{ metin: '', dosyaAdi: 'a' }] }, ciktiKoku))
      .toThrow(/boş olamaz/);
    expect(() => projeDogrula(
      { id, satirlar: [{ metin: 'a', dosyaAdi: 'x' }, { metin: 'b', dosyaAdi: 'x' }] },
      ciktiKoku,
    )).toThrow(/tekrar/);
    expect(() => projeDogrula({ id, ayarlar: { satirArasiBekleme: [9, 2] } }, ciktiKoku))
      .toThrow(/satirArasiBekleme/);
    expect(() => projeDogrula({ id, ayarlar: { tekrarDenemeSayisi: 0 } }, ciktiKoku))
      .toThrow(/tekrarDenemeSayisi/);
    expect(() => projeDogrula({ id, ciktiKlasoru: '   ' }, ciktiKoku)).toThrow(/ciktiKlasoru/);
  });

  it('bilinmeyen alanların ayarlara sızmasını önler', () => {
    const p = projeDogrula(
      { id: 'a-1111', ayarlar: { modelAdi: 'y', junkField: 'x', nested: { a: 1 } } },
      ciktiKoku,
    );
    expect(p.ayarlar).toEqual({ ...VARSAYILAN_AYARLAR, modelAdi: 'y' });
    expect(Object.keys(p.ayarlar).sort()).toEqual([
      'esZamanliSekme', 'modelAdi', 'rateLimitVarsayilanBeklemeDk', 'satirArasiBekleme',
      'tekrarDenemeSayisi', 'uretimZamanAsimiSn',
    ]);
  });
});

describe('projedenConfig', () => {
  it('proje ve chrome profilini Config\'e çevirir', () => {
    const proje = yeniProje('a-1111', 'A', ciktiKoku);
    const config = projedenConfig(proje, '/tmp/profil');
    expect(config.basePrompt).toBe(proje.basePrompt);
    expect(config.ciktiKlasoru).toBe(proje.ciktiKlasoru);
    expect(config.chromeProfil).toBe('/tmp/profil');
    expect(config.tekrarDenemeSayisi).toBe(proje.ayarlar.tekrarDenemeSayisi);
  });
});

describe('ProjelerDepo — oluşturma ve okuma', () => {
  it('proje yoksa boş liste döner', () => {
    expect(depo.listele()).toEqual({ projeler: [], bozukSayisi: 0 });
  });

  it('oluşturduğu projeyi id ile geri okur', () => {
    const olusan = depo.olustur('Kedi Serisi');
    expect(olusan.id.startsWith('kedi-serisi-')).toBe(true);
    expect(depo.oku(olusan.id)?.ad).toBe('Kedi Serisi');
    expect(olusan.olusturmaTarihi).not.toBe('');
  });

  it('listeyi ada göre sıralar ve özet alanlarını doldurur', () => {
    depo.olustur('Zebra');
    const kedi = depo.olustur('Kedi');
    depo.yaz({ ...depo.oku(kedi.id) as Proje, satirlar: [{ metin: 'a', dosyaAdi: 'a' }] });

    const liste = depo.listele();
    expect(liste.projeler.map((p) => p.ad)).toEqual(['Kedi', 'Zebra']);
    expect(liste.projeler[0].satirSayisi).toBe(1);
    expect(liste.projeler[0].ciktiKlasoru).toBe(join(ciktiKoku, 'kedi'));
  });

  it('aynı adlı ikinci projeye ayrı id ve ayrı klasör verir', () => {
    const bir = depo.olustur('Kedi');
    const iki = depo.olustur('Kedi');
    expect(iki.id).not.toBe(bir.id);
    expect(iki.ciktiKlasoru).not.toBe(bir.ciktiKlasoru);
  });

  it('geçersiz id için null döner, dosya sistemine bakmaz', () => {
    expect(depo.oku('../gizli')).toBeNull();
    expect(depo.oku('yok-1111')).toBeNull();
  });
});

describe('ProjelerDepo — yazma', () => {
  it('guncellemeTarihi damgalar', () => {
    const p = depo.olustur('Kedi');
    const yazilan = depo.yaz({ ...p, guncellemeTarihi: '' });
    expect(yazilan.guncellemeTarihi).not.toBe('');
  });

  it('başka bir projenin çıktı klasörünü kullanmayı reddeder', () => {
    const bir = depo.olustur('Kedi');
    const iki = depo.olustur('Plaj');

    expect(() => depo.yaz({ ...iki, ciktiKlasoru: bir.ciktiKlasoru }))
      .toThrow(/Kedi/);
  });

  it('projenin kendi klasörünü tekrar yazmasına izin verir', () => {
    const p = depo.olustur('Kedi');
    expect(() => depo.yaz({ ...p, ad: 'Kedi 2' })).not.toThrow();
  });
});

describe('ProjelerDepo — güncelleme', () => {
  it('gövdedeki id yoksayılır, parametredeki id kazanır', () => {
    const bir = depo.olustur('Kedi');
    const iki = depo.olustur('Plaj');

    depo.guncelle(iki.id, { ...(depo.oku(iki.id) as Proje), id: bir.id, ad: 'Değişti' });

    expect(depo.oku(iki.id)?.ad).toBe('Değişti');
    expect(depo.oku(bir.id)?.ad).toBe('Kedi');
  });

  it('doğrulama hatası olan gövdeyi reddeder', () => {
    const p = depo.olustur('Kedi');
    expect(() => depo.guncelle(p.id, { ...(depo.oku(p.id) as Proje), ciktiKlasoru: '   ' }))
      .toThrow(/ciktiKlasoru/);
  });

  it('başka bir projenin çıktı klasörünü kullanan gövdeyi reddeder', () => {
    const bir = depo.olustur('Kedi');
    const iki = depo.olustur('Plaj');

    expect(() => depo.guncelle(iki.id, { ...(depo.oku(iki.id) as Proje), ciktiKlasoru: bir.ciktiKlasoru }))
      .toThrow(/Kedi/);
  });
});

describe('ProjelerDepo — bozuk dosya', () => {
  it('bozuk dosyayı .bozuk olarak taşır, listede bozukSayisi olarak bildirir', () => {
    const hataSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mkdirSync(join(kok, 'projeler'), { recursive: true });
    const yol = join(kok, 'projeler', 'bozuk-1111.json');
    writeFileSync(yol, '{ bozuk json', 'utf-8');

    const liste = depo.listele();

    expect(liste.projeler).toEqual([]);
    expect(liste.bozukSayisi).toBe(1);
    expect(readFileSync(`${yol}.bozuk`, 'utf-8')).toBe('{ bozuk json');
    expect(hataSpy).toHaveBeenCalled();
    hataSpy.mockRestore();
  });

  it('geçerli JSON ama doğrulama hatası olan dosyayı da .bozuk yapar', () => {
    const hataSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mkdirSync(join(kok, 'projeler'), { recursive: true });
    const yol = join(kok, 'projeler', 'a-1111.json');
    writeFileSync(yol, JSON.stringify({ id: 'a-1111', ciktiKlasoru: '  ' }), 'utf-8');

    expect(depo.oku('a-1111')).toBeNull();
    expect(existsSync(`${yol}.bozuk`)).toBe(true);
    hataSpy.mockRestore();
  });
});

describe('ProjelerDepo — silme', () => {
  it('kaydı siler ve istenirse görselleri de siler', () => {
    const p = depo.olustur('Kedi');
    mkdirSync(p.ciktiKlasoru, { recursive: true });
    writeFileSync(join(p.ciktiKlasoru, 'a.png'), 'x');

    const sonuc = depo.sil(p.id, true);

    expect(sonuc).toEqual({ bulundu: true, silinen: 1, silinemeyen: [], korumaliKlasor: false });
    expect(depo.oku(p.id)).toBeNull();
    expect(existsSync(p.ciktiKlasoru)).toBe(false);
  });

  it('gorselleriSil false ise dosyalara dokunmaz', () => {
    const p = depo.olustur('Kedi');
    mkdirSync(p.ciktiKlasoru, { recursive: true });
    writeFileSync(join(p.ciktiKlasoru, 'a.png'), 'x');

    const sonuc = depo.sil(p.id, false);

    expect(sonuc.silinen).toBe(0);
    expect(existsSync(join(p.ciktiKlasoru, 'a.png'))).toBe(true);
    expect(depo.oku(p.id)).toBeNull();
  });

  it('çıktı kökünün kendisini korumalı sayar, kaydı yine siler', () => {
    const p = depo.olustur('Kedi');
    mkdirSync(ciktiKoku, { recursive: true });
    writeFileSync(join(ciktiKoku, 'a.png'), 'x');
    depo.yaz({ ...p, ciktiKlasoru: ciktiKoku });

    const sonuc = depo.sil(p.id, true);

    expect(sonuc.korumaliKlasor).toBe(true);
    expect(sonuc.silinen).toBe(0);
    expect(existsSync(join(ciktiKoku, 'a.png'))).toBe(true);
    expect(depo.oku(p.id)).toBeNull();
  });

  it('olmayan projede bulundu false döner', () => {
    expect(depo.sil('yok-1111', true).bulundu).toBe(false);
  });
});

describe('ProjelerDepo — göç', () => {
  it('eski proje.json dosyasını projeler/ altına taşır ve .tasindi bırakır', () => {
    const eski = join(kok, 'proje.json');
    writeFileSync(eski, JSON.stringify({
      ad: 'Eski Proje',
      basePrompt: 'Bir kedi, {VARYASYON}',
      ciktiKlasoru: join(ciktiKoku, 'eski'),
      satirlar: [{ metin: 'a', dosyaAdi: 'a' }],
    }), 'utf-8');

    expect(depo.gocEt()).toBe(true);

    const liste = depo.listele();
    expect(liste.projeler).toHaveLength(1);
    expect(liste.projeler[0].ad).toBe('Eski Proje');
    expect(existsSync(eski)).toBe(false);
    expect(existsSync(`${eski}.tasindi`)).toBe(true);
  });

  it('eski dosya yoksa false döner', () => {
    expect(depo.gocEt()).toBe(false);
  });

  it('iki kez çağrılırsa ikinci kez hiçbir şey yapmaz', () => {
    writeFileSync(join(kok, 'proje.json'), JSON.stringify({ ad: 'A' }), 'utf-8');
    depo.gocEt();
    expect(depo.gocEt()).toBe(false);
    expect(depo.listele().projeler).toHaveLength(1);
  });

  it('eski dosya bozuksa .bozuk yapar, false döner ve proje üretmez', () => {
    const hataSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    writeFileSync(join(kok, 'proje.json'), '{ bozuk', 'utf-8');

    expect(depo.gocEt()).toBe(false);
    expect(depo.listele().projeler).toEqual([]);
    expect(existsSync(join(kok, 'proje.json.bozuk'))).toBe(true);
    hataSpy.mockRestore();
  });
});

describe('esZamanliSekme ayarı', () => {
  const temel = { id: 'p1', ad: 'Proje' };

  it('alan yoksa 1 döner (eski proje dosyaları için göç yolu)', () => {
    const proje = projeDogrula({ ...temel, ayarlar: {} }, ciktiKoku);
    expect(proje.ayarlar.esZamanliSekme).toBe(1);
  });

  it('geçerli değeri korur', () => {
    const proje = projeDogrula({ ...temel, ayarlar: { esZamanliSekme: 3 } }, ciktiKoku);
    expect(proje.ayarlar.esZamanliSekme).toBe(3);
  });

  it('aralık dışını ve tam sayı olmayanı reddeder', () => {
    for (const gecersiz of [0, 5, 2.5, -1, '3']) {
      expect(() =>
        projeDogrula({ ...temel, ayarlar: { esZamanliSekme: gecersiz } }, ciktiKoku),
      ).toThrow('esZamanliSekme 1 ile 4 arasında tam sayı olmalı');
    }
  });

  it("projedenConfig alanı Config'e taşır", () => {
    const proje = projeDogrula({ ...temel, ayarlar: { esZamanliSekme: 2 } }, ciktiKoku);
    expect(projedenConfig(proje, '/tmp/profil').esZamanliSekme).toBe(2);
  });
});

describe('script alanı', () => {
  it('yazılıp okunur', () => {
    const proje = depo.olustur('Kedi');
    expect(proje.script).toBe('');

    depo.yaz({ ...proje, script: '(0:00) merhaba (0:09) dünya' });
    expect(depo.oku(proje.id)?.script).toBe('(0:00) merhaba (0:09) dünya');
  });

  it('script alanı olmayan eski dosyayı boş string ile okur', () => {
    const proje = depo.olustur('Kedi');

    const yol = join(kok, 'projeler', `${proje.id}.json`);
    const ham = JSON.parse(readFileSync(yol, 'utf-8'));
    delete ham.script;
    writeFileSync(yol, JSON.stringify(ham), 'utf-8');

    expect(depo.oku(proje.id)?.script).toBe('');
  });
});
