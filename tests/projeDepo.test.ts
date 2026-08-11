import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProjeDepo,
  VARSAYILAN_AYARLAR,
  projeDogrula,
  projedenConfig,
  varsayilanProje,
} from '../src/depo/projeDepo.js';

let kok: string;
const CIKTI_KOKU = '/tmp/cikti-koku';

beforeEach(() => {
  kok = mkdtempSync(join(tmpdir(), 'proje-test-'));
});
afterEach(() => {
  rmSync(kok, { recursive: true, force: true });
});

describe('varsayilanProje', () => {
  it('varsayılan ayarlarla ve boş satır listesiyle gelir', () => {
    const p = varsayilanProje(CIKTI_KOKU);
    expect(p.ayarlar).toEqual(VARSAYILAN_AYARLAR);
    expect(p.satirlar).toEqual([]);
    expect(p.basePrompt).toContain('{VARYASYON}');
    expect(p.ciktiKlasoru.startsWith(CIKTI_KOKU)).toBe(true);
  });
});

describe('projeDogrula', () => {
  it('eksik alanları varsayılanla doldurur', () => {
    const p = projeDogrula({ basePrompt: 'X {VARYASYON}' }, CIKTI_KOKU);
    expect(p.basePrompt).toBe('X {VARYASYON}');
    expect(p.ayarlar).toEqual(VARSAYILAN_AYARLAR);
  });

  it('satırları temizler ve dosya adını normalize eder', () => {
    const p = projeDogrula(
      { satirlar: [{ metin: '  karda ', dosyaAdi: 'kedi kar.png' }] },
      CIKTI_KOKU,
    );
    expect(p.satirlar).toEqual([{ metin: 'karda', dosyaAdi: 'kedi kar' }]);
  });

  it('boş metin veya boş dosya adı olan satırı reddeder', () => {
    expect(() => projeDogrula({ satirlar: [{ metin: '', dosyaAdi: 'a' }] }, CIKTI_KOKU)).toThrow(
      /boş olamaz/,
    );
  });

  it('tekrar eden dosya adını reddeder', () => {
    expect(() =>
      projeDogrula(
        { satirlar: [{ metin: 'a', dosyaAdi: 'x' }, { metin: 'b', dosyaAdi: 'x' }] },
        CIKTI_KOKU,
      ),
    ).toThrow(/tekrar/);
  });

  it('satirArasiBekleme hatalıysa reddeder', () => {
    expect(() =>
      projeDogrula({ ayarlar: { satirArasiBekleme: [9, 2] } }, CIKTI_KOKU),
    ).toThrow(/satirArasiBekleme/);
  });

  it('pozitif olmayan sayısal ayarı reddeder', () => {
    expect(() => projeDogrula({ ayarlar: { tekrarDenemeSayisi: 0 } }, CIKTI_KOKU)).toThrow(
      /tekrarDenemeSayisi/,
    );
  });

  it('boş çıktı klasörünü reddeder', () => {
    expect(() => projeDogrula({ ciktiKlasoru: '   ' }, CIKTI_KOKU)).toThrow(/ciktiKlasoru/);
  });

  // BULGU 1: ayarlariDogrula allowlist'siz spread kullanıyordu; bilinmeyen alanlar
  // sonuca sızıyordu. HTTP gövdesi doğrudan buraya akacağı için önemli.
  it('bilinmeyen alanların ayarlara sızmasını önler', () => {
    const p = projeDogrula(
      { ayarlar: { modelAdi: 'y', junkField: 'x', nested: { a: 1 } } },
      CIKTI_KOKU,
    );
    expect(p.ayarlar).toEqual({ ...VARSAYILAN_AYARLAR, modelAdi: 'y' });
    expect(p.ayarlar).not.toHaveProperty('junkField');
    expect(p.ayarlar).not.toHaveProperty('nested');
  });

  it('ayarlar dizi olarak verilirse sayısal indeks anahtarları sızmaz', () => {
    const p = projeDogrula({ ayarlar: [1, 2, 3] }, CIKTI_KOKU);
    expect(p.ayarlar).toEqual(VARSAYILAN_AYARLAR);
    expect(Object.keys(p.ayarlar).sort()).toEqual(
      [
        'modelAdi',
        'satirArasiBekleme',
        'uretimZamanAsimiSn',
        'tekrarDenemeSayisi',
        'rateLimitVarsayilanBeklemeDk',
      ].sort(),
    );
  });
});

describe('projedenConfig', () => {
  it('proje ve chrome profilini Config\'e çevirir', () => {
    const proje = varsayilanProje(CIKTI_KOKU);
    const config = projedenConfig(proje, '/tmp/profil');
    expect(config.basePrompt).toBe(proje.basePrompt);
    expect(config.ciktiKlasoru).toBe(proje.ciktiKlasoru);
    expect(config.chromeProfil).toBe('/tmp/profil');
    expect(config.tekrarDenemeSayisi).toBe(proje.ayarlar.tekrarDenemeSayisi);
  });
});

describe('ProjeDepo', () => {
  it('dosya yoksa varsayılan proje döner', () => {
    const depo = new ProjeDepo(kok);
    expect(depo.oku(CIKTI_KOKU).satirlar).toEqual([]);
  });

  it('yazdığını geri okur', () => {
    const depo = new ProjeDepo(kok);
    const proje = { ...varsayilanProje(CIKTI_KOKU), ad: 'Kedi serisi' };
    depo.yaz(proje);
    expect(depo.oku(CIKTI_KOKU).ad).toBe('Kedi serisi');
  });

  it('yazarken guncellemeTarihi damgalar', () => {
    const depo = new ProjeDepo(kok);
    depo.yaz({ ...varsayilanProje(CIKTI_KOKU), guncellemeTarihi: '' });
    expect(depo.oku(CIKTI_KOKU).guncellemeTarihi).not.toBe('');
  });

  it('bozuk dosyayı .bozuk olarak yeniden adlandırır ve varsayılan döner', () => {
    const yol = join(kok, 'proje.json');
    writeFileSync(yol, '{ bozuk json', 'utf-8');
    const depo = new ProjeDepo(kok);
    const proje = depo.oku(CIKTI_KOKU);
    expect(proje.satirlar).toEqual([]);
    expect(existsSync(`${yol}.bozuk`)).toBe(true);
    expect(readFileSync(`${yol}.bozuk`, 'utf-8')).toBe('{ bozuk json');
  });

  // BULGU 2: catch blokları hatayı sessizce yutuyordu; artık console.error ile
  // görünür olmalı (parse hatası yolu).
  it('parse hatasında console.error ile hatayı görünür kılar', () => {
    const hataSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const yol = join(kok, 'proje.json');
    writeFileSync(yol, '{ bozuk json', 'utf-8');
    const depo = new ProjeDepo(kok);
    depo.oku(CIKTI_KOKU);
    expect(hataSpy).toHaveBeenCalled();
    hataSpy.mockRestore();
  });

  // BULGU 4 (kapsam boşluğu): oku()'nun DOĞRULAMA HATASI yolu (parse hatası değil —
  // geçerli JSON ama örn. tekrar eden dosyaAdi) hiçbir testle kanıtlanmıyordu.
  it('geçerli JSON ama doğrulama hatası varsa .bozuk olarak taşır ve varsayılan döner', () => {
    const hataSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const yol = join(kok, 'proje.json');
    const icerik = JSON.stringify({
      satirlar: [
        { metin: 'a', dosyaAdi: 'x' },
        { metin: 'b', dosyaAdi: 'x' },
      ],
    });
    writeFileSync(yol, icerik, 'utf-8');
    const depo = new ProjeDepo(kok);
    const proje = depo.oku(CIKTI_KOKU);
    expect(proje.satirlar).toEqual([]);
    expect(existsSync(`${yol}.bozuk`)).toBe(true);
    expect(readFileSync(`${yol}.bozuk`, 'utf-8')).toBe(icerik);
    expect(hataSpy).toHaveBeenCalled();
    hataSpy.mockRestore();
  });

  // BULGU 3: renameSync hedefi sessizce eziyordu; art arda iki bozulma olayında
  // ilk yedek kaybolurdu. Artık ilk boş ".bozuk-N" adı bulunmalı.
  it('art arda iki bozuk dosya oluşursa ikisi de korunur', () => {
    const hataSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const yol = join(kok, 'proje.json');
    const depo = new ProjeDepo(kok);

    writeFileSync(yol, '{ birinci bozuk', 'utf-8');
    depo.oku(CIKTI_KOKU);
    expect(readFileSync(`${yol}.bozuk`, 'utf-8')).toBe('{ birinci bozuk');

    writeFileSync(yol, '{ ikinci bozuk', 'utf-8');
    depo.oku(CIKTI_KOKU);
    expect(readFileSync(`${yol}.bozuk`, 'utf-8')).toBe('{ birinci bozuk');
    expect(readFileSync(`${yol}.bozuk-2`, 'utf-8')).toBe('{ ikinci bozuk');

    hataSpy.mockRestore();
  });
});
