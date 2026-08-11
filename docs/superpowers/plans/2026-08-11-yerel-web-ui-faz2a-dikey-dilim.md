# Yerel Web UI — Faz 2A: Dikey Dilim

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npx`/`yarn baslat` ile açılan, tarayıcıda gerçek bir sayfa gösteren, gerçek ChatGPT'ye karşı görsel üretebilen en küçük çalışan ürün.

**Architecture:** Faz 1'in `IsYoneticisi`'si üzerine Fastify tabanlı bir lokal sunucu. Sunucu modülü Playwright'ı tanımaz — tarayıcı başlatma `baslat.ts`'te wiring ile enjekte edilir. UI tek dosya HTML (inline CSS+JS), build adımı yok. Kalıcılık tek bir `proje.json`.

**Tech Stack:** TypeScript (ESM, `.js` uzantılı importlar), Fastify 5, vitest, Node 20+. Frontend bağımlılığı yok.

## Global Constraints

- Tüm tanımlayıcılar Türkçe. Tek istisna: `signal` (`AbortController.signal` platform API adı).
- Import'lar `.js` uzantılı: `import { Kapi } from './kapi.js'`.
- **Playwright'a dokunan tek modül `src/tarayici.ts`'dir.** `src/sunucu/` altındaki hiçbir dosya `playwright` import etmez; tarayıcı `baslat.ts`'te enjekte edilir.
- Sunucu **yalnızca `127.0.0.1`'e** bağlanır, asla `0.0.0.0`'a.
- Dosya servis eden her rota, yolun izinli kök içinde kaldığını `path.resolve` ile doğrular (path traversal).
- Kabuk komutu string olarak çalıştırılmaz; `execFile` + argüman dizisi kullanılır.
- Her task sonunda `yarn test` ve `yarn typecheck` temiz geçmeli.
- **Commit atma:** kullanıcı açıkça istemedikçe hiçbir git komutu çalıştırılmaz (`git commit`/`add`/`rm` yasak). Dosya silme gerekiyorsa düz `rm`.

## Faz 1'den devralınan arayüzler

Bunlar mevcut, test edilmiş, **değiştirilmeyecek**:

```ts
// src/is/olaylar.ts
export type IsDurumu = 'bosta'|'calisiyor'|'duraklatildi'|'limitBekliyor'
                     |'kullaniciBekliyor'|'bitti'|'durduruldu'|'hata';
export type IsOlayi =
  | { tip: 'durum'; durum: IsDurumu; projeId: string | null; ozet: IslemOzeti }
  | { tip: 'satirBasladi'; sira: number; toplam: number; dosyaAdi: string }
  | { tip: 'gorselHazir'; dosyaAdi: string }
  | { tip: 'satirBitti'; sira: number; sonuc: 'basarili'|'atlandi'|'basarisiz'; sebep?: string }
  | { tip: 'limitBekleniyor'; kalanSn: number }
  | { tip: 'kullaniciGerekli'; mesaj: string }
  | { tip: 'hata'; mesaj: string }
  | { tip: 'bitti'; ozet: IslemOzeti };

// src/is/isYoneticisi.ts
export class IsYoneticisi {
  bilgi(): IsBilgisi;                       // { durum, projeId, ozet, sira, toplam }
  dinle(d: (olay: IsOlayi) => void): () => void;
  baslat(ayarlar: IsAyarlari): Promise<IslemOzeti>;
  duraklat(): void; devam(): void; durdur(): void; kullaniciHazir(): void;
}
export interface IsAyarlari {
  projeId: string; config: Config; satirlar: Satir[];
  tarayici: UretimTarayicisi; logger: Logger;
  tamamlandiMi: (dosyaAdi: string) => boolean;
  basarisizKaydet: (satir: Satir, sebep: string) => void;
  uyuMotoru?: (ms: number, secenekler: UykuSecenekleri) => Promise<void>;
}

// src/tipler.ts
export interface Config { basePrompt; ciktiKlasoru; chromeProfil; modelAdi;
  satirArasiBekleme: [number,number]; uretimZamanAsimiSn; tekrarDenemeSayisi;
  rateLimitVarsayilanBeklemeDk }
export interface Satir { metin: string; dosyaAdi: string }
export interface IslemOzeti { basarili: number; atlanan: number; basarisiz: number }

// src/liste.ts
export function csvAyristir(icerik: string): string[][];
export function dosyaAdiTemizle(ad: string): string;

// src/durum.ts
export function ciktiYolu(ciktiKlasoru: string, dosyaAdi: string): string;  // <klasör>/<ad>.png
export function tamamlandiMi(ciktiKlasoru: string, dosyaAdi: string): boolean;
export function basarisizKaydet(dosyaYolu: string, satir: Satir, sebep: string): void;

// src/prompt.ts
export function promptOlustur(basePrompt: string, metin: string): string;  // {VARYASYON} yoksa THROW
```

## Kapsam

**Dahil:** tek proje kalıcılığı, base prompt düzenleme + doğrulama + önizleme, CSV metnini yapıştırarak satır girme, iş başlat/duraklat/devam/durdur, SSE canlı ilerleme, rate-limit geri sayımı, kullanıcı-gerekli uyarısı + Devam butonu, galeri, klasörü aç, loopback + token güvenliği.

**Hariç (Faz 2B):** çoklu proje/geçmiş, base prompt ekleri (dosya/görsel), CSV dosya yükleme/indirme, seçici onarım ekranı, React'e geçiş.

---

### Task 1: Yollar ve atomik yazma

**Files:**
- Create: `src/depo/yollar.ts`
- Create: `src/depo/atomik.ts`
- Test: `tests/depo-atomik.test.ts`

**Interfaces:**
- Consumes: yok
- Produces:
```ts
// src/depo/yollar.ts
export const VARSAYILAN_VERI_KOKU: string;      // ~/.chatgpt-gorsel-uretici
export const VARSAYILAN_CIKTI_KOKU: string;     // ~/ChatGPT-Gorseller
export function projeYolu(veriKoku: string): string;        // <kok>/proje.json
export function chromeProfilYolu(veriKoku: string): string; // <kok>/chrome_profil
export function icerdeMi(kok: string, aday: string): boolean;

// src/depo/atomik.ts
export function atomikYaz(yol: string, icerik: string): void;
```

`icerdeMi` path-traversal savunmasının çekirdeği: `aday` normalize edildikten sonra `kok` içinde mi. Saf fonksiyon, dosya sistemine dokunmaz.

- [ ] **Step 1: Write the failing test**

```ts
// tests/depo-atomik.test.ts
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { atomikYaz } from '../src/depo/atomik.js';
import { chromeProfilYolu, icerdeMi, projeYolu } from '../src/depo/yollar.js';

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

  it('yazma sırasında hedef dosya asla yarım kalmaz (rename atomik)', () => {
    const yol = join(kok, 'x.json');
    atomikYaz(yol, 'a'.repeat(100_000));
    expect(existsSync(yol)).toBe(true);
    expect(readFileSync(yol, 'utf-8').length).toBe(100_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run tests/depo-atomik.test.ts`
Expected: FAIL — `Failed to resolve import "../src/depo/atomik.js"`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/depo/yollar.ts
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

export const VARSAYILAN_VERI_KOKU = join(homedir(), '.chatgpt-gorsel-uretici');
export const VARSAYILAN_CIKTI_KOKU = join(homedir(), 'ChatGPT-Gorseller');

export function projeYolu(veriKoku: string): string {
  return join(veriKoku, 'proje.json');
}

export function chromeProfilYolu(veriKoku: string): string {
  return join(veriKoku, 'chrome_profil');
}

/** `aday` normalize edildiğinde `kok` içinde kalıyor mu? Path traversal savunması. */
export function icerdeMi(kok: string, aday: string): boolean {
  const fark = relative(resolve(kok), resolve(aday));
  if (fark === '') return true;                    // adayın kendisi kök
  if (fark.startsWith('..')) return false;         // kökün dışına çıkıyor
  if (isAbsolute(fark)) return false;              // farklı sürücü (Windows)
  return true;
}
```

```ts
// src/depo/atomik.ts
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * Geçici dosyaya yazıp rename ile taşır. rename atomiktir; yazma sırasında
 * çökme olsa bile hedef dosya ya eski hali ya yeni hali olur, asla yarım kalmaz.
 */
export function atomikYaz(yol: string, icerik: string): void {
  const klasor = dirname(yol);
  mkdirSync(klasor, { recursive: true });

  const gecici = join(klasor, `.tmp-${process.pid}-${basename(yol)}`);
  const fd = openSync(gecici, 'w');
  try {
    writeSync(fd, icerik, 0, 'utf-8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(gecici, yol);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run tests/depo-atomik.test.ts && yarn typecheck`
Expected: 8 passed, typecheck temiz

- [ ] **Step 5: Commit — ATLA** (bu oturumda commit atılmıyor)

---

### Task 2: Proje deposu

**Files:**
- Create: `src/depo/projeDepo.ts`
- Test: `tests/projeDepo.test.ts`
- Delete: `src/config.ts`, `tests/config.test.ts`

**Interfaces:**
- Consumes: `atomikYaz`, `projeYolu` (Task 1); `Satir`, `Config` (`src/tipler.ts`)
- Produces:
```ts
export interface Ayarlar {
  modelAdi: string;
  satirArasiBekleme: [number, number];
  uretimZamanAsimiSn: number;
  tekrarDenemeSayisi: number;
  rateLimitVarsayilanBeklemeDk: number;
}
export interface Proje {
  ad: string;
  basePrompt: string;
  ciktiKlasoru: string;
  satirlar: Satir[];
  ayarlar: Ayarlar;
  guncellemeTarihi: string;
}
export const VARSAYILAN_AYARLAR: Ayarlar;
export function varsayilanProje(ciktiKoku: string): Proje;
export function projeDogrula(ham: unknown, ciktiKoku: string): Proje;   // hatalıysa throw
export function projedenConfig(proje: Proje, chromeProfil: string): Config;
export class ProjeDepo {
  constructor(veriKoku: string);
  oku(ciktiKoku: string): Proje;
  yaz(proje: Proje): void;
}
```

**Neden `src/config.ts` siliniyor:** `config.json` diye bir dosya kalmadı; doğrulama mantığı `projeDogrula` içinde yeniden yazılıyor. Ölü kod bırakılmaz. `tests/config.test.ts` de silinir; anlamlı vakaları `tests/projeDepo.test.ts`'e taşınmış olur.

`oku()` davranışı: dosya yoksa varsayılan proje döner (hata değil). Dosya var ama parse edilemiyorsa `<yol>.bozuk` olarak yeniden adlandırır ve varsayılan döner — sessizce silmez. Eksik alanlar varsayılanla doldurulur.

- [ ] **Step 1: Write the failing test**

```ts
// tests/projeDepo.test.ts
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
});

describe('projedenConfig', () => {
  it('proje ve chrome profilini Config'e çevirir', () => {
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run tests/projeDepo.test.ts`
Expected: FAIL — `Failed to resolve import "../src/depo/projeDepo.js"`

- [ ] **Step 3: Write the implementation**

```ts
// src/depo/projeDepo.ts
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { dosyaAdiTemizle } from '../liste.js';
import type { Config, Satir } from '../tipler.js';
import { atomikYaz } from './atomik.js';
import { projeYolu } from './yollar.js';

export interface Ayarlar {
  modelAdi: string;
  satirArasiBekleme: [number, number];
  uretimZamanAsimiSn: number;
  tekrarDenemeSayisi: number;
  rateLimitVarsayilanBeklemeDk: number;
}

export interface Proje {
  ad: string;
  basePrompt: string;
  ciktiKlasoru: string;
  satirlar: Satir[];
  ayarlar: Ayarlar;
  guncellemeTarihi: string;
}

export const VARSAYILAN_AYARLAR: Ayarlar = {
  modelAdi: '',
  satirArasiBekleme: [5, 15],
  uretimZamanAsimiSn: 180,
  tekrarDenemeSayisi: 3,
  rateLimitVarsayilanBeklemeDk: 15,
};

export function varsayilanProje(ciktiKoku: string): Proje {
  return {
    ad: 'Yeni proje',
    basePrompt: 'Bir kedi, {VARYASYON}, yüksek detaylı',
    ciktiKlasoru: join(ciktiKoku, 'yeni-proje'),
    satirlar: [],
    ayarlar: { ...VARSAYILAN_AYARLAR },
    guncellemeTarihi: '',
  };
}

export function projeDogrula(ham: unknown, ciktiKoku: string): Proje {
  const kaynak = (typeof ham === 'object' && ham !== null ? ham : {}) as Record<string, unknown>;
  const varsayilan = varsayilanProje(ciktiKoku);

  const ad = metinAlan(kaynak.ad, varsayilan.ad);
  const basePrompt = metinAlan(kaynak.basePrompt, varsayilan.basePrompt);

  const ciktiKlasoru = metinAlan(kaynak.ciktiKlasoru, varsayilan.ciktiKlasoru);
  if (ciktiKlasoru.trim() === '') throw new Error('ciktiKlasoru boş olamaz');

  return {
    ad,
    basePrompt,
    ciktiKlasoru: ciktiKlasoru.trim(),
    satirlar: satirlariDogrula(kaynak.satirlar),
    ayarlar: ayarlariDogrula(kaynak.ayarlar),
    guncellemeTarihi: metinAlan(kaynak.guncellemeTarihi, ''),
  };
}

export function projedenConfig(proje: Proje, chromeProfil: string): Config {
  return {
    basePrompt: proje.basePrompt,
    ciktiKlasoru: proje.ciktiKlasoru,
    chromeProfil,
    modelAdi: proje.ayarlar.modelAdi,
    satirArasiBekleme: proje.ayarlar.satirArasiBekleme,
    uretimZamanAsimiSn: proje.ayarlar.uretimZamanAsimiSn,
    tekrarDenemeSayisi: proje.ayarlar.tekrarDenemeSayisi,
    rateLimitVarsayilanBeklemeDk: proje.ayarlar.rateLimitVarsayilanBeklemeDk,
  };
}

export class ProjeDepo {
  constructor(private veriKoku: string) {}

  oku(ciktiKoku: string): Proje {
    const yol = projeYolu(this.veriKoku);
    if (!existsSync(yol)) return varsayilanProje(ciktiKoku);

    let ham: unknown;
    try {
      ham = JSON.parse(readFileSync(yol, 'utf-8'));
    } catch {
      renameSync(yol, `${yol}.bozuk`);
      return varsayilanProje(ciktiKoku);
    }

    try {
      return projeDogrula(ham, ciktiKoku);
    } catch {
      renameSync(yol, `${yol}.bozuk`);
      return varsayilanProje(ciktiKoku);
    }
  }

  yaz(proje: Proje): void {
    const damgali: Proje = { ...proje, guncellemeTarihi: new Date().toISOString() };
    atomikYaz(projeYolu(this.veriKoku), JSON.stringify(damgali, null, 2));
  }
}

function metinAlan(deger: unknown, varsayilan: string): string {
  return typeof deger === 'string' ? deger : varsayilan;
}

function satirlariDogrula(ham: unknown): Satir[] {
  if (!Array.isArray(ham)) return [];
  const satirlar: Satir[] = [];
  const gorulen = new Set<string>();

  for (const [sira, kayit] of ham.entries()) {
    const k = (typeof kayit === 'object' && kayit !== null ? kayit : {}) as Record<string, unknown>;
    const metin = typeof k.metin === 'string' ? k.metin.trim() : '';
    const dosyaAdi = dosyaAdiTemizle(typeof k.dosyaAdi === 'string' ? k.dosyaAdi : '');

    if (metin === '' || dosyaAdi === '') {
      throw new Error(`${sira + 1}. satır: "metin" ve "dosya_adi" boş olamaz`);
    }
    if (gorulen.has(dosyaAdi)) {
      throw new Error(`${sira + 1}. satır: "${dosyaAdi}" dosya adı tekrar ediyor`);
    }
    gorulen.add(dosyaAdi);
    satirlar.push({ metin, dosyaAdi });
  }
  return satirlar;
}

function ayarlariDogrula(ham: unknown): Ayarlar {
  const kaynak = (typeof ham === 'object' && ham !== null ? ham : {}) as Record<string, unknown>;
  const ayarlar: Ayarlar = { ...VARSAYILAN_AYARLAR, ...kaynak } as Ayarlar;

  if (typeof ayarlar.modelAdi !== 'string') {
    throw new Error('modelAdi metin olmalı');
  }

  const bekleme = ayarlar.satirArasiBekleme;
  if (
    !Array.isArray(bekleme) ||
    bekleme.length !== 2 ||
    bekleme.some((sn) => typeof sn !== 'number' || !Number.isFinite(sn) || sn < 0) ||
    bekleme[0] > bekleme[1]
  ) {
    throw new Error('satirArasiBekleme [min, maks] saniye olmalı (min <= maks)');
  }

  for (const alan of ['uretimZamanAsimiSn', 'tekrarDenemeSayisi', 'rateLimitVarsayilanBeklemeDk'] as const) {
    const deger = ayarlar[alan];
    if (typeof deger !== 'number' || !Number.isFinite(deger) || deger <= 0) {
      throw new Error(`${alan} pozitif bir sayı olmalı`);
    }
  }

  return ayarlar;
}
```

- [ ] **Step 4: Delete the dead config module**

```bash
rm src/config.ts tests/config.test.ts
```

(`git rm` DEĞİL — düz `rm`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn test && yarn typecheck`
Expected: `tests/projeDepo.test.ts` 13 passed; `config.test.ts` artık yok; typecheck temiz

- [ ] **Step 6: Commit — ATLA**

---

### Task 3: Prompt doğrulama ve önizleme

**Files:**
- Modify: `src/prompt.ts` (mevcut `promptOlustur` korunur, iki fonksiyon eklenir)
- Test: `tests/prompt.test.ts` (mevcut testlere ekleme)

**Interfaces:**
- Consumes: `Satir` (`src/tipler.ts`)
- Produces:
```ts
export const YER_TUTUCU = '{VARYASYON}';
export function yerTutucuVarMi(basePrompt: string): boolean;
export function onizlemeUret(basePrompt: string, satirlar: Satir[], adet?: number): string[];
```

`onizlemeUret` yer tutucu yoksa **boş dizi** döner (fırlatmaz) — UI zaten ayrı bir doğrulama mesajı gösterecek. Varsayılan `adet` 3.

- [ ] **Step 1: Write the failing test**

`tests/prompt.test.ts` dosyasının sonuna ekle:

```ts
import { YER_TUTUCU, onizlemeUret, yerTutucuVarMi } from '../src/prompt.js';
import type { Satir } from '../src/tipler.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run tests/prompt.test.ts`
Expected: FAIL — `yerTutucuVarMi is not a function` / export bulunamadı

- [ ] **Step 3: Write the implementation**

`src/prompt.ts` dosyasını şu hale getir (mevcut `promptOlustur` davranışı aynen korunur):

```ts
import type { Satir } from './tipler.js';

export const YER_TUTUCU = '{VARYASYON}';

export function promptOlustur(basePrompt: string, metin: string): string {
  if (!basePrompt.includes(YER_TUTUCU)) {
    throw new Error(`basePrompt içinde ${YER_TUTUCU} yer tutucusu bulunamadı`);
  }
  return basePrompt.replaceAll(YER_TUTUCU, metin);
}

export function yerTutucuVarMi(basePrompt: string): boolean {
  return basePrompt.includes(YER_TUTUCU);
}

/** İlk `adet` satırın gerçekte gönderilecek halini üretir. Yer tutucu yoksa boş dizi. */
export function onizlemeUret(basePrompt: string, satirlar: Satir[], adet = 3): string[] {
  if (!yerTutucuVarMi(basePrompt)) return [];
  return satirlar.slice(0, adet).map((satir) => promptOlustur(basePrompt, satir.metin));
}
```

**Not:** Mevcut `tests/prompt.test.ts` bir testte hata mesajını kontrol ediyor olabilir. Mesaj artık şablonla üretiliyor ama metni aynı: `basePrompt içinde {VARYASYON} yer tutucusu bulunamadı`. Mevcut testler değişmeden geçmeli; geçmiyorsa mesajı birebir eskisine sabitle.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test && yarn typecheck`
Expected: mevcut prompt testleri + 8 yeni test geçer, typecheck temiz

- [ ] **Step 5: Commit — ATLA**

---

### Task 4: İstek yetkilendirme (saf mantık)

**Files:**
- Create: `src/sunucu/guvenlik.ts`
- Test: `tests/guvenlik.test.ts`

**Interfaces:**
- Consumes: yok
- Produces:
```ts
export interface YetkiGirdisi {
  token?: string;      // ?t= veya x-token başlığından
  origin?: string;     // Origin başlığı (yoksa undefined)
}
export interface YetkiBeklentisi {
  token: string;
  izinliOrigin: string;   // ör. "http://127.0.0.1:3000"
}
export function istekYetkili(girdi: YetkiGirdisi, beklenen: YetkiBeklentisi): boolean;
export function tokenUret(): string;
```

**Neden saf fonksiyon:** yetkilendirme kararı tarayıcısız ve sunucusuz test edilebilmeli. Fastify hook'u Task 5'te bu fonksiyonu çağırır.

Kurallar:
- Token eşleşmiyorsa reddet (sabit süreli karşılaştırma gerekmiyor — token URL'de zaten görünür, gizlilik değil CSRF savunması).
- `Origin` başlığı **varsa** izinli origin'e eşit olmalı; **yoksa** kabul (tarayıcı dışı istemciler ve same-origin GET'ler Origin göndermez).

- [ ] **Step 1: Write the failing test**

```ts
// tests/guvenlik.test.ts
import { describe, expect, it } from 'vitest';
import { istekYetkili, tokenUret } from '../src/sunucu/guvenlik.js';

const BEKLENEN = { token: 'gizli123', izinliOrigin: 'http://127.0.0.1:3000' };

describe('istekYetkili', () => {
  it('doğru token ve izinli origin ile kabul eder', () => {
    expect(istekYetkili({ token: 'gizli123', origin: 'http://127.0.0.1:3000' }, BEKLENEN)).toBe(true);
  });

  it('Origin başlığı yoksa kabul eder', () => {
    expect(istekYetkili({ token: 'gizli123' }, BEKLENEN)).toBe(true);
  });

  it('token yanlışsa reddeder', () => {
    expect(istekYetkili({ token: 'yanlis' }, BEKLENEN)).toBe(false);
  });

  it('token yoksa reddeder', () => {
    expect(istekYetkili({}, BEKLENEN)).toBe(false);
  });

  it('yabancı origin ile reddeder (kötü niyetli site localhost.a istek atarsa)', () => {
    expect(istekYetkili({ token: 'gizli123', origin: 'https://kotu-site.com' }, BEKLENEN)).toBe(false);
  });

  it('farklı portlu localhost origin ile reddeder', () => {
    expect(istekYetkili({ token: 'gizli123', origin: 'http://127.0.0.1:9999' }, BEKLENEN)).toBe(false);
  });
});

describe('tokenUret', () => {
  it('yeterince uzun ve her seferinde farklı token üretir', () => {
    const a = tokenUret();
    const b = tokenUret();
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toBe(b);
  });

  it('URL güvenli karakterler üretir', () => {
    expect(tokenUret()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run tests/guvenlik.test.ts`
Expected: FAIL — `Failed to resolve import "../src/sunucu/guvenlik.js"`

- [ ] **Step 3: Write the implementation**

```ts
// src/sunucu/guvenlik.ts
import { randomBytes } from 'node:crypto';

export interface YetkiGirdisi {
  token?: string;
  origin?: string;
}

export interface YetkiBeklentisi {
  token: string;
  izinliOrigin: string;
}

/**
 * Yerel sunucu kullanıcının ChatGPT oturumunu süren bir tarayıcıyı kontrol ediyor.
 * Kullanıcı kötü niyetli bir siteyi gezerken o sitenin JavaScript'i 127.0.0.1'e
 * istek atabilir; token ve Origin kontrolü bunu engeller.
 */
export function istekYetkili(girdi: YetkiGirdisi, beklenen: YetkiBeklentisi): boolean {
  if (girdi.token !== beklenen.token) return false;
  if (girdi.origin !== undefined && girdi.origin !== beklenen.izinliOrigin) return false;
  return true;
}

export function tokenUret(): string {
  return randomBytes(24).toString('base64url');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run tests/guvenlik.test.ts && yarn typecheck`
Expected: 8 passed, typecheck temiz

- [ ] **Step 5: Commit — ATLA**

---

### Task 5: Sunucu — proje ve önizleme rotaları

**Files:**
- Create: `src/sunucu/index.ts`
- Test: `tests/sunucu-proje.test.ts`
- Modify: `package.json` (fastify bağımlılığı)

**Interfaces:**
- Consumes: `ProjeDepo`, `Proje`, `projeDogrula`, `varsayilanProje` (Task 2); `onizlemeUret`, `yerTutucuVarMi` (Task 3); `istekYetkili` (Task 4); `IsYoneticisi` (Faz 1)
- Produces:
```ts
export interface SunucuBagimliliklari {
  depo: ProjeDepo;
  isYoneticisi: IsYoneticisi;
  isBaslat: (proje: Proje) => void;      // Task 6'da kullanılır; Playwright wiring baslat.ts'te
  token: string;
  izinliOrigin: () => string;            // istek anında okunur
  ciktiKoku: string;
  webKlasoru: string;
  klasoruAc: (yol: string) => void;      // Task 7'de kullanılır
}
export function sunucuOlustur(b: SunucuBagimliliklari): FastifyInstance;
```

**`izinliOrigin` neden fonksiyon:** gerçek port ancak `listen()` sonrası bilinir, ama izinli Origin porta bağlıdır. Sabit string olsaydı sunucuyu bir kez port bulmak için, bir kez de gerçekten kaldırmak için iki kez ayağa kaldırmak gerekirdi — arada portu başka bir süreç kapabilir. Fonksiyon olarak istek anında okunur, tek `listen()` yeter.

**Kritik sınır:** bu dosya `playwright` import ETMEZ. Tarayıcı `isBaslat` geri çağrısının arkasında kalır. Testler `fastify.inject()` ile çalışır, gerçek port dinlenmez.

Bu task'ta sadece şu rotalar: `GET /`, `GET /api/proje`, `PUT /api/proje`, `POST /api/proje/onizleme`. Diğerleri Task 6 ve 7'de aynı dosyaya eklenir.

- [ ] **Step 1: Add the dependency**

```bash
yarn add fastify
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/sunucu-proje.test.ts
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjeDepo, varsayilanProje } from '../src/depo/projeDepo.js';
import { IsYoneticisi } from '../src/is/isYoneticisi.js';
import { sunucuOlustur } from '../src/sunucu/index.js';

const TOKEN = 'test-token';
const ORIGIN = 'http://127.0.0.1:3000';

let kok: string;
let web: string;
let uygulama: ReturnType<typeof sunucuOlustur>;

beforeEach(() => {
  kok = mkdtempSync(join(tmpdir(), 'sunucu-test-'));
  web = join(kok, 'web');
  mkdirSync(web, { recursive: true });
  writeFileSync(join(web, 'index.html'), '<h1>merhaba</h1>', 'utf-8');

  uygulama = sunucuOlustur({
    depo: new ProjeDepo(kok),
    isYoneticisi: new IsYoneticisi(),
    isBaslat: () => {},
    token: TOKEN,
    izinliOrigin: () => ORIGIN,
    ciktiKoku: join(kok, 'cikti'),
    webKlasoru: web,
    klasoruAc: () => {},
  });
});

afterEach(async () => {
  await uygulama.close();
  rmSync(kok, { recursive: true, force: true });
});

const yetkili = (ek: Record<string, string> = {}) => ({ 'x-token': TOKEN, origin: ORIGIN, ...ek });

describe('güvenlik kapısı', () => {
  it('tokensiz API isteğini 401 ile reddeder', async () => {
    const y = await uygulama.inject({ method: 'GET', url: '/api/proje' });
    expect(y.statusCode).toBe(401);
  });

  it('yanlış tokenla reddeder', async () => {
    const y = await uygulama.inject({
      method: 'GET',
      url: '/api/proje',
      headers: { 'x-token': 'yanlis' },
    });
    expect(y.statusCode).toBe(401);
  });

  it('yabancı Origin ile reddeder', async () => {
    const y = await uygulama.inject({
      method: 'GET',
      url: '/api/proje',
      headers: yetkili({ origin: 'https://kotu-site.com' }),
    });
    expect(y.statusCode).toBe(401);
  });

  it('tokeni sorgu parametresinden de kabul eder', async () => {
    const y = await uygulama.inject({ method: 'GET', url: `/api/proje?t=${TOKEN}` });
    expect(y.statusCode).toBe(200);
  });
});

describe('GET /', () => {
  it('web klasöründeki index.html dosyasını servis eder', async () => {
    const y = await uygulama.inject({ method: 'GET', url: `/?t=${TOKEN}` });
    expect(y.statusCode).toBe(200);
    expect(y.headers['content-type']).toContain('text/html');
    expect(y.body).toContain('merhaba');
  });
});

describe('GET /api/proje', () => {
  it('kayıt yoksa varsayılan projeyi döner', async () => {
    const y = await uygulama.inject({ method: 'GET', url: '/api/proje', headers: yetkili() });
    expect(y.statusCode).toBe(200);
    expect(y.json().satirlar).toEqual([]);
    expect(y.json().basePrompt).toContain('{VARYASYON}');
  });
});

describe('PUT /api/proje', () => {
  it('geçerli projeyi kaydeder ve geri okur', async () => {
    const proje = { ...varsayilanProje(join(kok, 'cikti')), ad: 'Kedi serisi' };
    const yaz = await uygulama.inject({
      method: 'PUT',
      url: '/api/proje',
      headers: yetkili(),
      payload: proje,
    });
    expect(yaz.statusCode).toBe(200);

    const oku = await uygulama.inject({ method: 'GET', url: '/api/proje', headers: yetkili() });
    expect(oku.json().ad).toBe('Kedi serisi');
  });

  it('geçersiz projeyi 400 ve hata mesajıyla reddeder', async () => {
    const y = await uygulama.inject({
      method: 'PUT',
      url: '/api/proje',
      headers: yetkili(),
      payload: { satirlar: [{ metin: '', dosyaAdi: 'a' }] },
    });
    expect(y.statusCode).toBe(400);
    expect(y.json().hata).toMatch(/boş olamaz/);
  });

  it('iş çalışırken projeyi değiştirmeyi 409 ile reddeder', async () => {
    const yonetici = uygulama.testIsYoneticisi;
    // iş "calisiyor" durumuna sokulur
    void yonetici.baslat({
      projeId: 'x',
      config: {
        basePrompt: 'a {VARYASYON}', ciktiKlasoru: '/tmp', chromeProfil: '/tmp',
        modelAdi: '', satirArasiBekleme: [0, 0], uretimZamanAsimiSn: 1,
        tekrarDenemeSayisi: 1, rateLimitVarsayilanBeklemeDk: 1,
      },
      satirlar: [{ metin: 'a', dosyaAdi: 'a' }],
      tarayici: {
        baslat: async () => {}, yenidenBaslat: async () => {}, yeniSohbetAc: async () => {},
        oturumAcikMi: async () => true, aktifModelAdi: async () => '',
        gorselUret: () => new Promise(() => {}), // asılı kalır, iş çalışır durumda tutulur
        sonGorseliKaydet: async () => {}, kapat: async () => {},
      },
      logger: { bilgi: () => {}, uyari: () => {}, hata: () => {} } as never,
      tamamlandiMi: () => false,
      basarisizKaydet: () => {},
      uyuMotoru: async () => {},
    });
    await new Promise((c) => setTimeout(c, 10));

    const y = await uygulama.inject({
      method: 'PUT',
      url: '/api/proje',
      headers: yetkili(),
      payload: varsayilanProje(join(kok, 'cikti')),
    });
    expect(y.statusCode).toBe(409);
    yonetici.durdur();
  });
});

describe('POST /api/proje/onizleme', () => {
  it('ilk 3 satırın render edilmiş halini döner', async () => {
    const y = await uygulama.inject({
      method: 'POST',
      url: '/api/proje/onizleme',
      headers: yetkili(),
      payload: {
        basePrompt: 'Bir kedi, {VARYASYON}, detaylı',
        satirlar: [
          { metin: 'karda', dosyaAdi: 'a' },
          { metin: 'plajda', dosyaAdi: 'b' },
          { metin: 'ormanda', dosyaAdi: 'c' },
          { metin: 'çölde', dosyaAdi: 'd' },
        ],
      },
    });
    expect(y.statusCode).toBe(200);
    expect(y.json().yerTutucuVar).toBe(true);
    expect(y.json().onizleme).toEqual([
      'Bir kedi, karda, detaylı',
      'Bir kedi, plajda, detaylı',
      'Bir kedi, ormanda, detaylı',
    ]);
  });

  it('yer tutucu yoksa yerTutucuVar false ve boş önizleme döner', async () => {
    const y = await uygulama.inject({
      method: 'POST',
      url: '/api/proje/onizleme',
      headers: yetkili(),
      payload: { basePrompt: 'Bir kedi', satirlar: [{ metin: 'karda', dosyaAdi: 'a' }] },
    });
    expect(y.json().yerTutucuVar).toBe(false);
    expect(y.json().onizleme).toEqual([]);
  });
});
```

**Not:** test `uygulama.testIsYoneticisi` kullanıyor — `sunucuOlustur` enjekte edilen yöneticiyi Fastify örneğine `decorate` ile bu adla iliştirmeli ki test aynı örneğe erişebilsin.

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn vitest run tests/sunucu-proje.test.ts`
Expected: FAIL — `Failed to resolve import "../src/sunucu/index.js"`

- [ ] **Step 4: Write the implementation**

```ts
// src/sunucu/index.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Proje, ProjeDepo } from '../depo/projeDepo.js';
import { projeDogrula } from '../depo/projeDepo.js';
import type { IsYoneticisi } from '../is/isYoneticisi.js';
import { onizlemeUret, yerTutucuVarMi } from '../prompt.js';
import type { Satir } from '../tipler.js';
import { istekYetkili } from './guvenlik.js';

export interface SunucuBagimliliklari {
  depo: ProjeDepo;
  isYoneticisi: IsYoneticisi;
  isBaslat: (proje: Proje) => void;
  token: string;
  izinliOrigin: () => string;
  ciktiKoku: string;
  webKlasoru: string;
  klasoruAc: (yol: string) => void;
}

declare module 'fastify' {
  interface FastifyInstance {
    testIsYoneticisi: IsYoneticisi;
  }
}

const MESGUL_DURUMLAR = ['calisiyor', 'duraklatildi', 'limitBekliyor', 'kullaniciBekliyor'];

export function sunucuOlustur(b: SunucuBagimliliklari): FastifyInstance {
  const uygulama = Fastify({ logger: false });
  uygulama.decorate('testIsYoneticisi', b.isYoneticisi);

  uygulama.addHook('onRequest', async (istek, yanit) => {
    const sorgu = istek.query as Record<string, string | undefined>;
    const basliktan = istek.headers['x-token'];
    const token = typeof basliktan === 'string' ? basliktan : sorgu?.t;
    const origin = istek.headers.origin;

    if (!istekYetkili({ token, origin }, { token: b.token, izinliOrigin: b.izinliOrigin() })) {
      await yanit.code(401).send({ hata: 'yetkisiz istek' });
    }
  });

  uygulama.get('/', async (_istek, yanit) => {
    const html = readFileSync(join(b.webKlasoru, 'index.html'), 'utf-8');
    return yanit.type('text/html; charset=utf-8').send(html);
  });

  uygulama.get('/api/proje', async () => b.depo.oku(b.ciktiKoku));

  uygulama.put('/api/proje', async (istek, yanit) => {
    if (mesgulMu(b.isYoneticisi)) {
      return yanit.code(409).send({ hata: 'iş çalışırken proje değiştirilemez' });
    }
    try {
      const proje = projeDogrula(istek.body, b.ciktiKoku);
      b.depo.yaz(proje);
      return b.depo.oku(b.ciktiKoku);
    } catch (hata) {
      return yanit.code(400).send({ hata: (hata as Error).message });
    }
  });

  uygulama.post('/api/proje/onizleme', async (istek) => {
    const govde = (istek.body ?? {}) as { basePrompt?: string; satirlar?: Satir[] };
    const basePrompt = govde.basePrompt ?? '';
    const satirlar = Array.isArray(govde.satirlar) ? govde.satirlar : [];
    return {
      yerTutucuVar: yerTutucuVarMi(basePrompt),
      onizleme: onizlemeUret(basePrompt, satirlar),
    };
  });

  return uygulama;
}

export function mesgulMu(isYoneticisi: IsYoneticisi): boolean {
  return MESGUL_DURUMLAR.includes(isYoneticisi.bilgi().durum);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn test && yarn typecheck`
Expected: `tests/sunucu-proje.test.ts` 11 passed, typecheck temiz

- [ ] **Step 6: Commit — ATLA**

---

### Task 6: Sunucu — iş rotaları ve SSE

**Files:**
- Modify: `src/sunucu/index.ts` (rotalar eklenir)
- Test: `tests/sunucu-is.test.ts`

**Interfaces:**
- Consumes: Task 5'in `SunucuBagimliliklari`'sı; `IsYoneticisi`, `IsOlayi` (Faz 1)
- Produces: yeni rotalar — `GET /api/is`, `POST /api/is/baslat|duraklat|devam|durdur|kullanici-hazir`, `GET /api/is/akis` (SSE)

**SSE sözleşmesi:** her olay `data: <JSON>\n\n` biçiminde yazılır. Bağlantı açılır açılmaz mevcut durum `{"tip":"durum",...}` olarak gönderilir ki UI yenilendiğinde senkron kalsın. Bağlantı kapanınca dinleyici sökülür (`dinle`'nin döndürdüğü fonksiyon).

`POST /api/is/baslat` deposundan projeyi okur, boş satır listesi veya eksik yer tutucu varsa 400 döner, aksi halde `b.isBaslat(proje)` çağırır ve 202 döner. Playwright'a dokunmaz.

- [ ] **Step 1: Write the failing test**

```ts
// tests/sunucu-is.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjeDepo, varsayilanProje } from '../src/depo/projeDepo.js';
import { IsYoneticisi } from '../src/is/isYoneticisi.js';
import { sunucuOlustur } from '../src/sunucu/index.js';

const TOKEN = 'test-token';
const ORIGIN = 'http://127.0.0.1:3000';
const yetkili = () => ({ 'x-token': TOKEN, origin: ORIGIN });

let kok: string;
let uygulama: ReturnType<typeof sunucuOlustur>;
let baslatilanProjeler: string[];
let isYoneticisi: IsYoneticisi;

beforeEach(() => {
  kok = mkdtempSync(join(tmpdir(), 'sunucu-is-'));
  const web = join(kok, 'web');
  mkdirSync(web, { recursive: true });
  writeFileSync(join(web, 'index.html'), '<h1>x</h1>', 'utf-8');

  baslatilanProjeler = [];
  isYoneticisi = new IsYoneticisi();

  const depo = new ProjeDepo(kok);
  depo.yaz({
    ...varsayilanProje(join(kok, 'cikti')),
    satirlar: [{ metin: 'karda', dosyaAdi: 'kedi_kar' }],
  });

  uygulama = sunucuOlustur({
    depo,
    isYoneticisi,
    isBaslat: (proje) => baslatilanProjeler.push(proje.ad),
    token: TOKEN,
    izinliOrigin: () => ORIGIN,
    ciktiKoku: join(kok, 'cikti'),
    webKlasoru: web,
    klasoruAc: () => {},
  });
});

afterEach(async () => {
  await uygulama.close();
  rmSync(kok, { recursive: true, force: true });
});

describe('GET /api/is', () => {
  it('mevcut durumu döner', async () => {
    const y = await uygulama.inject({ method: 'GET', url: '/api/is', headers: yetkili() });
    expect(y.statusCode).toBe(200);
    expect(y.json().durum).toBe('bosta');
  });
});

describe('POST /api/is/baslat', () => {
  it('projeyi okur ve isBaslat geri çağrısını tetikler', async () => {
    const y = await uygulama.inject({ method: 'POST', url: '/api/is/baslat', headers: yetkili() });
    expect(y.statusCode).toBe(202);
    expect(baslatilanProjeler).toHaveLength(1);
  });

  it('satır listesi boşsa 400 döner ve iş başlatmaz', async () => {
    new ProjeDepo(kok).yaz({ ...varsayilanProje(join(kok, 'cikti')), satirlar: [] });
    const y = await uygulama.inject({ method: 'POST', url: '/api/is/baslat', headers: yetkili() });
    expect(y.statusCode).toBe(400);
    expect(y.json().hata).toMatch(/satır/i);
    expect(baslatilanProjeler).toHaveLength(0);
  });

  it('base promptta yer tutucu yoksa 400 döner ve iş başlatmaz', async () => {
    new ProjeDepo(kok).yaz({
      ...varsayilanProje(join(kok, 'cikti')),
      basePrompt: 'Bir kedi',
      satirlar: [{ metin: 'karda', dosyaAdi: 'a' }],
    });
    const y = await uygulama.inject({ method: 'POST', url: '/api/is/baslat', headers: yetkili() });
    expect(y.statusCode).toBe(400);
    expect(y.json().hata).toMatch(/VARYASYON/);
    expect(baslatilanProjeler).toHaveLength(0);
  });
});

describe('iş kontrol rotaları', () => {
  it('duraklat, devam, durdur ve kullanici-hazir yöneticiye iletilir', async () => {
    const duraklat = vi.spyOn(isYoneticisi, 'duraklat');
    const devam = vi.spyOn(isYoneticisi, 'devam');
    const durdur = vi.spyOn(isYoneticisi, 'durdur');
    const hazir = vi.spyOn(isYoneticisi, 'kullaniciHazir');

    for (const yol of ['duraklat', 'devam', 'durdur', 'kullanici-hazir']) {
      const y = await uygulama.inject({
        method: 'POST',
        url: `/api/is/${yol}`,
        headers: yetkili(),
      });
      expect(y.statusCode).toBe(200);
    }

    expect(duraklat).toHaveBeenCalledOnce();
    expect(devam).toHaveBeenCalledOnce();
    expect(durdur).toHaveBeenCalledOnce();
    expect(hazir).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
});

describe('GET /api/is/akis (SSE)', () => {
  it('SSE başlıklarıyla yanıt verir ve açılışta mevcut durumu gönderir', async () => {
    const sunucu = await uygulama.listen({ port: 0, host: '127.0.0.1' });
    const yanit = await fetch(`${sunucu}/api/is/akis?t=${TOKEN}`);

    expect(yanit.headers.get('content-type')).toContain('text/event-stream');

    const okuyucu = yanit.body!.getReader();
    const { value } = await okuyucu.read();
    const metin = new TextDecoder().decode(value);
    expect(metin).toContain('data: ');
    expect(JSON.parse(metin.replace(/^data: /, '').trim()).tip).toBe('durum');

    await okuyucu.cancel();
  });

  it('bağlantı kapanınca dinleyiciyi söker', async () => {
    const sunucu = await uygulama.listen({ port: 0, host: '127.0.0.1' });
    const yanit = await fetch(`${sunucu}/api/is/akis?t=${TOKEN}`);
    const okuyucu = yanit.body!.getReader();
    await okuyucu.read();
    await okuyucu.cancel();

    await new Promise((c) => setTimeout(c, 50));
    // dinleyici söküldüyse yayın kimseye gitmez ve hata fırlatmaz
    expect(() => isYoneticisi.durdur()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run tests/sunucu-is.test.ts`
Expected: FAIL — `/api/is` rotası yok, 404

- [ ] **Step 3: Write the implementation**

`src/sunucu/index.ts` içine, `return uygulama;` satırından ÖNCE ekle:

```ts
  uygulama.get('/api/is', async () => b.isYoneticisi.bilgi());

  uygulama.post('/api/is/baslat', async (_istek, yanit) => {
    if (mesgulMu(b.isYoneticisi)) {
      return yanit.code(409).send({ hata: 'bir iş zaten çalışıyor' });
    }
    const proje = b.depo.oku(b.ciktiKoku);

    if (proje.satirlar.length === 0) {
      return yanit.code(400).send({ hata: 'listede hiç satır yok' });
    }
    if (!yerTutucuVarMi(proje.basePrompt)) {
      return yanit.code(400).send({
        hata: 'Prompt içinde {VARYASYON} yok — her satır aynı görseli üretirdi',
      });
    }

    b.isBaslat(proje);
    return yanit.code(202).send({ baslatildi: true });
  });

  for (const [yol, eylem] of [
    ['duraklat', () => b.isYoneticisi.duraklat()],
    ['devam', () => b.isYoneticisi.devam()],
    ['durdur', () => b.isYoneticisi.durdur()],
    ['kullanici-hazir', () => b.isYoneticisi.kullaniciHazir()],
  ] as const) {
    uygulama.post(`/api/is/${yol}`, async () => {
      eylem();
      return b.isYoneticisi.bilgi();
    });
  }

  uygulama.get('/api/is/akis', (istek, yanit) => {
    yanit.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const yaz = (veri: unknown) => {
      if (!yanit.raw.writableEnded) yanit.raw.write(`data: ${JSON.stringify(veri)}\n\n`);
    };

    const bilgi = b.isYoneticisi.bilgi();
    yaz({ tip: 'durum', durum: bilgi.durum, projeId: bilgi.projeId, ozet: bilgi.ozet });

    const sok = b.isYoneticisi.dinle(yaz);
    istek.raw.on('close', () => {
      sok();
      if (!yanit.raw.writableEnded) yanit.raw.end();
    });
  });
```

`yerTutucuVarMi` zaten Task 5'te import edilmişti; yeni import gerekmiyor.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test && yarn typecheck`
Expected: `tests/sunucu-is.test.ts` 8 passed, typecheck temiz

- [ ] **Step 5: Commit — ATLA**

---

### Task 7: Sunucu — galeri, görsel servisi, klasörü aç

**Files:**
- Modify: `src/sunucu/index.ts` (rotalar eklenir)
- Create: `src/sunucu/klasor.ts`
- Test: `tests/sunucu-galeri.test.ts`

**Interfaces:**
- Consumes: `icerdeMi` (Task 1); Task 5'in `SunucuBagimliliklari`'sı
- Produces:
```ts
// src/sunucu/klasor.ts
export interface Calistirilacak { komut: string; argumanlar: string[] }
export function klasorKomutu(platform: NodeJS.Platform, yol: string): Calistirilacak;
export function urlKomutu(platform: NodeJS.Platform, url: string): Calistirilacak;
export function klasoruAc(yol: string): void;
export function urlAc(url: string): void;
```

**`klasoruAc` ve `urlAc` neden ayrı:** macOS'ta `open -R <yol>` dosyayı Finder'da *seçili gösterir* — bir URL'ye uygulanınca tarayıcı açmaz. URL için argümansız `open <url>` gerekir. Windows'ta da klasör için `explorer`, URL için `cmd /c start` gerekir. Tek fonksiyona sıkıştırmak sessizce yanlış davranış üretir.
Yeni rotalar: `GET /api/galeri`, `GET /api/gorsel/:ad`, `POST /api/klasoru-ac`

**Güvenlik:** `GET /api/gorsel/:ad` yalnızca projenin çıktı klasörü içindeki `.png` dosyalarını servis eder. `icerdeMi` ile doğrular. `POST /api/klasoru-ac` yalnızca projenin çıktı klasörünü açar — istemciden yol almaz, bu yüzden traversal yüzeyi yok.

**Kabuk yok:** `klasorKomutu` komut ve argüman dizisi döner, `execFile` ile çalıştırılır. Bu ayrım komut üretimini platformdan bağımsız test edilebilir yapar.

- [ ] **Step 1: Write the failing test**

```ts
// tests/sunucu-galeri.test.ts
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjeDepo, varsayilanProje } from '../src/depo/projeDepo.js';
import { IsYoneticisi } from '../src/is/isYoneticisi.js';
import { sunucuOlustur } from '../src/sunucu/index.js';
import { klasorKomutu, urlKomutu } from '../src/sunucu/klasor.js';

const TOKEN = 'test-token';
const ORIGIN = 'http://127.0.0.1:3000';
const yetkili = () => ({ 'x-token': TOKEN, origin: ORIGIN });

// 1x1 saydam PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let kok: string;
let ciktiKlasoru: string;
let acilanYollar: string[];
let uygulama: ReturnType<typeof sunucuOlustur>;

beforeEach(() => {
  kok = mkdtempSync(join(tmpdir(), 'galeri-test-'));
  ciktiKlasoru = join(kok, 'cikti', 'proje');
  mkdirSync(ciktiKlasoru, { recursive: true });
  const web = join(kok, 'web');
  mkdirSync(web, { recursive: true });
  writeFileSync(join(web, 'index.html'), '<h1>x</h1>', 'utf-8');

  writeFileSync(join(ciktiKlasoru, 'kedi_kar.png'), PNG);
  writeFileSync(join(ciktiKlasoru, 'kedi_plaj.png'), PNG);
  writeFileSync(join(ciktiKlasoru, 'notlar.txt'), 'png değil', 'utf-8');
  writeFileSync(join(kok, 'gizli.png'), PNG);

  const depo = new ProjeDepo(kok);
  depo.yaz({ ...varsayilanProje(join(kok, 'cikti')), ciktiKlasoru });

  acilanYollar = [];
  uygulama = sunucuOlustur({
    depo,
    isYoneticisi: new IsYoneticisi(),
    isBaslat: () => {},
    token: TOKEN,
    izinliOrigin: () => ORIGIN,
    ciktiKoku: join(kok, 'cikti'),
    webKlasoru: web,
    klasoruAc: (yol) => acilanYollar.push(yol),
  });
});

afterEach(async () => {
  await uygulama.close();
  rmSync(kok, { recursive: true, force: true });
});

describe('klasorKomutu', () => {
  it('macOS için open -R üretir', () => {
    expect(klasorKomutu('darwin', '/a/b')).toEqual({ komut: 'open', argumanlar: ['-R', '/a/b'] });
  });
  it('Windows için explorer üretir', () => {
    expect(klasorKomutu('win32', 'C:\\a')).toEqual({ komut: 'explorer', argumanlar: ['C:\\a'] });
  });
  it('Linux için xdg-open üretir', () => {
    expect(klasorKomutu('linux', '/a/b')).toEqual({ komut: 'xdg-open', argumanlar: ['/a/b'] });
  });
  it('yolu asla kabuk stringine gömmez (argüman dizisi döner)', () => {
    const { argumanlar } = klasorKomutu('darwin', '/a/b; rm -rf /');
    expect(argumanlar.at(-1)).toBe('/a/b; rm -rf /');
  });
});

describe('urlKomutu', () => {
  it('macOS için open kullanır, -R KULLANMAZ (-R Finder gösterir, tarayıcı açmaz)', () => {
    expect(urlKomutu('darwin', 'http://127.0.0.1:3000/?t=x')).toEqual({
      komut: 'open',
      argumanlar: ['http://127.0.0.1:3000/?t=x'],
    });
  });
  it('Windows için cmd /c start üretir (boş başlık argümanıyla)', () => {
    expect(urlKomutu('win32', 'http://a')).toEqual({
      komut: 'cmd',
      argumanlar: ['/c', 'start', '', 'http://a'],
    });
  });
  it('Linux için xdg-open üretir', () => {
    expect(urlKomutu('linux', 'http://a')).toEqual({ komut: 'xdg-open', argumanlar: ['http://a'] });
  });
});

describe('GET /api/galeri', () => {
  it('yalnızca png dosyalarını sıralı listeler', async () => {
    const y = await uygulama.inject({ method: 'GET', url: '/api/galeri', headers: yetkili() });
    expect(y.statusCode).toBe(200);
    expect(y.json().dosyalar).toEqual(['kedi_kar.png', 'kedi_plaj.png']);
  });

  it('çıktı klasörü yoksa boş liste döner', async () => {
    rmSync(ciktiKlasoru, { recursive: true, force: true });
    const y = await uygulama.inject({ method: 'GET', url: '/api/galeri', headers: yetkili() });
    expect(y.statusCode).toBe(200);
    expect(y.json().dosyalar).toEqual([]);
  });
});

describe('GET /api/gorsel/:ad', () => {
  it('png dosyasını doğru content-type ile servis eder', async () => {
    const y = await uygulama.inject({
      method: 'GET',
      url: '/api/gorsel/kedi_kar.png',
      headers: yetkili(),
    });
    expect(y.statusCode).toBe(200);
    expect(y.headers['content-type']).toContain('image/png');
    expect(y.rawPayload.length).toBe(PNG.length);
  });

  it('olmayan dosya için 404 döner', async () => {
    const y = await uygulama.inject({
      method: 'GET',
      url: '/api/gorsel/yok.png',
      headers: yetkili(),
    });
    expect(y.statusCode).toBe(404);
  });

  it('png olmayan dosyayı reddeder', async () => {
    const y = await uygulama.inject({
      method: 'GET',
      url: '/api/gorsel/notlar.txt',
      headers: yetkili(),
    });
    expect(y.statusCode).toBe(400);
  });

  it('path traversal ile klasör dışına çıkmayı reddeder', async () => {
    const y = await uygulama.inject({
      method: 'GET',
      url: '/api/gorsel/..%2Fgizli.png',
      headers: yetkili(),
    });
    expect([400, 404]).toContain(y.statusCode);
  });

  it('çıktı klasöründeki symlink ile dışarı sızdırmayı reddeder', async () => {
    // Sözdizimsel kontrolü geçen ama gerçekte kök dışını gösteren bağlantı
    symlinkSync(join(kok, 'gizli.png'), join(ciktiKlasoru, 'tuzak.png'));
    const y = await uygulama.inject({
      method: 'GET',
      url: '/api/gorsel/tuzak.png',
      headers: yetkili(),
    });
    expect(y.statusCode).toBe(404);
  });
});

describe('POST /api/klasoru-ac', () => {
  it('projenin çıktı klasörünü açar', async () => {
    const y = await uygulama.inject({
      method: 'POST',
      url: '/api/klasoru-ac',
      headers: yetkili(),
    });
    expect(y.statusCode).toBe(200);
    expect(acilanYollar).toEqual([ciktiKlasoru]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run tests/sunucu-galeri.test.ts`
Expected: FAIL — `Failed to resolve import "../src/sunucu/klasor.js"`

- [ ] **Step 3: Write `src/sunucu/klasor.ts`**

```ts
// src/sunucu/klasor.ts
import { execFile } from 'node:child_process';

export interface Calistirilacak {
  komut: string;
  argumanlar: string[];
}

export function klasorKomutu(platform: NodeJS.Platform, yol: string): Calistirilacak {
  if (platform === 'darwin') return { komut: 'open', argumanlar: ['-R', yol] };
  if (platform === 'win32') return { komut: 'explorer', argumanlar: [yol] };
  return { komut: 'xdg-open', argumanlar: [yol] };
}

/**
 * URL için ayrı komut: macOS'ta `open -R` dosyayı Finder'da gösterir, tarayıcı
 * açmaz. Windows'ta `start` bir kabuk builtin'i olduğu için `cmd /c` gerekir;
 * ikinci argüman (boş string) `start`'ın pencere başlığı beklentisini karşılar,
 * yoksa URL başlık sanılır.
 */
export function urlKomutu(platform: NodeJS.Platform, url: string): Calistirilacak {
  if (platform === 'darwin') return { komut: 'open', argumanlar: [url] };
  if (platform === 'win32') return { komut: 'cmd', argumanlar: ['/c', 'start', '', url] };
  return { komut: 'xdg-open', argumanlar: [url] };
}

/** Kabuk stringi kullanılmaz; yol argüman dizisiyle geçer, enjeksiyon yüzeyi yok. */
export function klasoruAc(yol: string): void {
  calistir(klasorKomutu(process.platform, yol));
}

export function urlAc(url: string): void {
  calistir(urlKomutu(process.platform, url));
}

function calistir({ komut, argumanlar }: Calistirilacak): void {
  execFile(komut, argumanlar, () => {
    // açılmazsa sessiz geç; kritik yol değil, kullanıcı adresi terminalden kopyalayabilir
  });
}
```

- [ ] **Step 4: Add the routes to `src/sunucu/index.ts`**

`return uygulama;` satırından ÖNCE ekle:

```ts
  uygulama.get('/api/galeri', async () => {
    const klasor = b.depo.oku(b.ciktiKoku).ciktiKlasoru;
    if (!existsSync(klasor)) return { dosyalar: [] };
    const dosyalar = readdirSync(klasor)
      .filter((ad) => ad.toLowerCase().endsWith('.png'))
      .sort();
    return { dosyalar };
  });

  uygulama.get('/api/gorsel/:ad', async (istek, yanit) => {
    const { ad } = istek.params as { ad: string };
    if (!ad.toLowerCase().endsWith('.png')) {
      return yanit.code(400).send({ hata: 'yalnızca png servis edilir' });
    }

    const klasor = b.depo.oku(b.ciktiKoku).ciktiKlasoru;
    const istenen = join(klasor, ad);

    // Önce sözdizimsel kontrol (ucuz, `..` gibi kaba denemeleri eler)
    if (!icerdeMi(klasor, istenen)) {
      return yanit.code(400).send({ hata: 'klasör dışına çıkılamaz' });
    }
    // Sonra symlink çözerek gerçek kontrol — `icerdeMi` symlink çözmez
    const yol = gercekYolIcerdeMi(klasor, istenen);
    if (yol === null) {
      return yanit.code(404).send({ hata: 'görsel bulunamadı' });
    }
    return yanit.type('image/png').send(readFileSync(yol));
  });

  uygulama.post('/api/klasoru-ac', async () => {
    const klasor = b.depo.oku(b.ciktiKoku).ciktiKlasoru;
    mkdirSync(klasor, { recursive: true });
    b.klasoruAc(klasor);
    return { acildi: true };
  });
```

Dosyanın başındaki import satırını güncelle:

```ts
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { gercekYolIcerdeMi, icerdeMi } from '../depo/yollar.js';
```

**İki katmanlı yol doğrulaması:** `icerdeMi` sözdizimseldir ve symlink çözmez — `..` gibi kaba denemeleri ucuza eler. `gercekYolIcerdeMi` `realpathSync` ile symlink'leri çözüp gerçek konumu doğrular; dosya yoksa veya kök dışına çıkıyorsa `null` döner. Tek başına sözdizimsel kontrole güvenmek, çıktı klasörüne yerleştirilmiş bir symlink üzerinden dışarı sızdırır.

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn test && yarn typecheck`
Expected: `tests/sunucu-galeri.test.ts` 11 passed, typecheck temiz

- [ ] **Step 6: Commit — ATLA**

---

### Task 8: Giriş noktası — `src/baslat.ts`

**Files:**
- Create: `src/baslat.ts`
- Modify: `package.json` (`baslat` script'i geri gelir)
- Test: yok — bu dosya saf wiring; tüm mantık alt modüllerde test edilmiş durumda

**Interfaces:**
- Consumes: her şey — `ProjeDepo`, `IsYoneticisi`, `ChatgptTarayicisi`, `sunucuOlustur`, `klasoruAc`, `tokenUret`, `projedenConfig`, `tamamlandiMi`, `basarisizKaydet`, `Logger`
- Produces: çalıştırılabilir giriş noktası

**Sorumluluk:** boş port bul, token üret, bileşenleri bağla, tarayıcıyı **tembel** başlat (ilk iş başlatıldığında, uygulama açılışında değil), UI'ı varsayılan tarayıcıda aç.

**Neden tembel tarayıcı:** kullanıcı sadece prompt düzenlemek için açtıysa Chromium açılmamalı.

- [ ] **Step 1: Write the implementation**

```ts
// src/baslat.ts
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjeDepo, projedenConfig, type Proje } from './depo/projeDepo.js';
import { VARSAYILAN_CIKTI_KOKU, VARSAYILAN_VERI_KOKU, chromeProfilYolu } from './depo/yollar.js';
import { basarisizKaydet, tamamlandiMi } from './durum.js';
import { IsYoneticisi } from './is/isYoneticisi.js';
import { Logger } from './logger.js';
import { sunucuOlustur } from './sunucu/index.js';
import { tokenUret } from './sunucu/guvenlik.js';
import { klasoruAc, urlAc } from './sunucu/klasor.js';
import { ChatgptTarayicisi } from './tarayici.js';

const web = fileURLToPath(new URL('../web', import.meta.url));

async function main(): Promise<void> {
  const veriKoku = process.env.GORSEL_VERI_KOKU ?? VARSAYILAN_VERI_KOKU;
  const ciktiKoku = process.env.GORSEL_CIKTI_KOKU ?? VARSAYILAN_CIKTI_KOKU;
  mkdirSync(veriKoku, { recursive: true });

  const token = tokenUret();
  const depo = new ProjeDepo(veriKoku);
  const isYoneticisi = new IsYoneticisi();
  const logger = new Logger(join(veriKoku, 'calisma.log'));
  const profil = chromeProfilYolu(veriKoku);

  let tarayici: ChatgptTarayicisi | null = null;

  const isBaslat = (proje: Proje): void => {
    void (async () => {
      try {
        mkdirSync(proje.ciktiKlasoru, { recursive: true });
        if (!tarayici) {
          tarayici = new ChatgptTarayicisi(profil);
          await tarayici.baslat();
        }
        await isYoneticisi.baslat({
          projeId: proje.ad,
          config: projedenConfig(proje, profil),
          satirlar: proje.satirlar,
          tarayici,
          logger,
          tamamlandiMi: (dosyaAdi) => tamamlandiMi(proje.ciktiKlasoru, dosyaAdi),
          basarisizKaydet: (satir, sebep) =>
            basarisizKaydet(join(proje.ciktiKlasoru, 'basarisizlar.csv'), satir, sebep),
        });
      } catch (hata) {
        logger.hata(`iş başarısız: ${(hata as Error).message}`);
      }
    })();
  };

  // Gerçek port ancak listen() sonrası bilinir; izinliOrigin fonksiyon olduğu
  // için istek anında okunur ve sunucuyu iki kez ayağa kaldırmaya gerek kalmaz.
  let adres = '';

  const uygulama = sunucuOlustur({
    depo, isYoneticisi, isBaslat, token,
    izinliOrigin: () => adres,
    ciktiKoku, webKlasoru: web, klasoruAc,
  });

  await uygulama.listen({ port: Number(process.env.PORT ?? 0), host: '127.0.0.1' });
  const port = (uygulama.server.address() as { port: number }).port;
  adres = `http://127.0.0.1:${port}`;

  const url = `${adres}/?t=${token}`;
  console.log(`\n  ChatGPT Görsel Üretici çalışıyor:\n  ${url}\n`);
  urlAc(url);

  const kapat = async () => {
    await uygulama.close();
    await tarayici?.kapat().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', kapat);
  process.on('SIGTERM', kapat);
}

main().catch((hata) => {
  console.error(`ölümcül hata: ${(hata as Error).message}`);
  process.exit(1);
});
```

- [ ] **Step 2: Restore the start script**

`package.json` `scripts` bloğunu şu hale getir:

```json
  "scripts": {
    "baslat": "tsx src/baslat.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
```

- [ ] **Step 3: Verify it type-checks**

Run: `yarn typecheck && yarn test`
Expected: typecheck temiz, tüm testler geçer

- [ ] **Step 4: Commit — ATLA**

---

### Task 9: UI — `web/index.html`

**Files:**
- Create: `web/index.html`
- Test: yok (spec §13: UI mantığı ince tutulur, tarayıcı testi yok)

**Interfaces:**
- Consumes: Task 5-7'deki HTTP API'nin tamamı

Tek dosya: inline CSS + inline JS, build adımı yok. Token sayfa URL'sinden (`?t=`) okunur ve tüm isteklere `x-token` başlığı olarak eklenir; SSE `EventSource` başlık gönderemediği için `?t=` sorgu parametresiyle bağlanır.

**Ekran bölümleri:**
1. Üst çubuk: başlık, durum rozeti (renk kodlu), Başlat / Duraklat / Devam / Durdur
2. Uyarı kartı — `kullaniciGerekli` olayında görünür, "Giriş yaptım, devam et" butonu
3. Sol: base prompt textarea + `{VARYASYON}` doğrulaması + canlı önizleme (ilk 3 satır)
4. Sol alt: satırlar textarea (CSV yapıştırma: `metin,dosya_adi`), çıktı klasörü, ayarlar
5. Sağ: ilerleme (x/y, sayaçlar, rate-limit geri sayımı), galeri ızgarası, "Klasörü aç"

**Tema:** açık/koyu, `prefers-color-scheme` ile.

- [ ] **Step 1: Write `web/index.html`**

```html
<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ChatGPT Görsel Üretici</title>
<style>
  :root {
    --zemin: #f7f7f8; --kart: #ffffff; --metin: #1a1a1a; --soluk: #6b7280;
    --kenar: #e3e3e6; --vurgu: #10a37f; --uyari: #d97706; --hata: #dc2626;
    --golge: 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --zemin: #1b1b1d; --kart: #252527; --metin: #ececef; --soluk: #9b9ba3;
      --kenar: #37373b; --golge: 0 1px 3px rgba(0,0,0,.3);
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--zemin); color: var(--metin);
    font: 15px/1.55 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  header {
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    padding: 14px 20px; background: var(--kart);
    border-bottom: 1px solid var(--kenar); position: sticky; top: 0; z-index: 10;
  }
  h1 { font-size: 16px; margin: 0; margin-right: auto; font-weight: 650; }
  button {
    font: inherit; font-weight: 550; padding: 8px 15px; border-radius: 8px;
    border: 1px solid var(--kenar); background: var(--kart); color: var(--metin);
    cursor: pointer;
  }
  button:hover:not(:disabled) { border-color: var(--soluk); }
  button:disabled { opacity: .4; cursor: not-allowed; }
  button.birincil { background: var(--vurgu); border-color: var(--vurgu); color: #fff; }
  #rozet {
    font-size: 13px; font-weight: 600; padding: 5px 11px; border-radius: 999px;
    background: var(--zemin); border: 1px solid var(--kenar);
  }
  main {
    display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr);
    gap: 18px; padding: 18px; max-width: 1400px; margin: 0 auto; align-items: start;
  }
  @media (max-width: 900px) { main { grid-template-columns: 1fr; } }
  section {
    background: var(--kart); border: 1px solid var(--kenar);
    border-radius: 12px; padding: 16px; box-shadow: var(--golge);
  }
  section + section { margin-top: 18px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em;
       color: var(--soluk); margin: 0 0 10px; font-weight: 650; }
  label { display: block; font-size: 13px; color: var(--soluk); margin: 12px 0 5px; }
  textarea, input {
    width: 100%; font: inherit; padding: 9px 11px; border-radius: 8px;
    border: 1px solid var(--kenar); background: var(--zemin); color: var(--metin);
  }
  textarea { resize: vertical; }
  textarea.kod { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  .hatali { border-color: var(--hata) !important; }
  .uyari-metin { color: var(--hata); font-size: 13px; margin-top: 6px; display: none; }
  .satir { display: flex; gap: 10px; }
  .satir > * { flex: 1; }
  #onizleme { list-style: none; padding: 0; margin: 8px 0 0; }
  #onizleme li {
    font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; color: var(--soluk);
    padding: 5px 0; border-top: 1px dashed var(--kenar); overflow-wrap: anywhere;
  }
  #kullaniciKart {
    display: none; margin: 0 18px; padding: 14px 16px; border-radius: 12px;
    background: color-mix(in srgb, var(--uyari) 12%, var(--kart));
    border: 1px solid var(--uyari);
  }
  #kullaniciKart p { margin: 0 0 10px; }
  #ilerlemeCubuk { height: 7px; background: var(--zemin); border-radius: 999px; overflow: hidden; }
  #ilerlemeDolgu { height: 100%; width: 0; background: var(--vurgu); transition: width .3s; }
  #sayaclar { display: flex; gap: 16px; font-size: 13px; color: var(--soluk); margin-top: 10px; }
  #sayaclar b { color: var(--metin); }
  #geriSayim { display: none; margin-top: 10px; color: var(--uyari); font-weight: 600; }
  #galeri {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 10px; margin-top: 10px;
  }
  #galeri figure { margin: 0; }
  #galeri img {
    width: 100%; aspect-ratio: 1; object-fit: cover;
    border-radius: 8px; border: 1px solid var(--kenar); background: var(--zemin);
  }
  #galeri figcaption {
    font-size: 11px; color: var(--soluk); margin-top: 4px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .bos { color: var(--soluk); font-size: 13px; }
  #kayit {
    font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: var(--soluk);
    max-height: 160px; overflow-y: auto; margin-top: 10px;
  }
</style>
</head>
<body>

<header>
  <h1>ChatGPT Görsel Üretici</h1>
  <span id="rozet">boşta</span>
  <button id="btnBaslat" class="birincil">Başlat</button>
  <button id="btnDuraklat" disabled>Duraklat</button>
  <button id="btnDevam" disabled>Devam</button>
  <button id="btnDurdur" disabled>Durdur</button>
</header>

<div id="kullaniciKart">
  <p id="kullaniciMesaj"></p>
  <button id="btnHazir" class="birincil">Giriş yaptım, devam et</button>
</div>

<main>
  <div>
    <section>
      <h2>Base prompt</h2>
      <textarea id="basePrompt" class="kod" rows="4"></textarea>
      <p class="uyari-metin" id="promptUyari">
        Prompt içinde <code>{VARYASYON}</code> yok — her satır aynı görseli üretirdi.
      </p>
      <button id="btnYerTutucu" style="margin-top:8px">{VARYASYON} ekle</button>
      <h2 style="margin-top:16px">Önizleme — ilk 3 satır</h2>
      <ul id="onizleme"><li class="bos">Satır ekleyin</li></ul>
    </section>

    <section>
      <h2>Satırlar (CSV yapıştırın)</h2>
      <textarea id="satirlar" class="kod" rows="9"
        placeholder="metin,dosya_adi&#10;kar yağarken dağ evinde,dag_evi_kis&#10;plajda gün batımında,plaj_gunbatimi"></textarea>
      <p class="uyari-metin" id="satirUyari"></p>
      <label>Çıktı klasörü</label>
      <input id="ciktiKlasoru" spellcheck="false">
      <div class="satir">
        <div>
          <label>Model adı (boş = kontrol yok)</label>
          <input id="modelAdi" placeholder="GPT-5">
        </div>
        <div>
          <label>Satır arası bekleme (sn)</label>
          <div class="satir">
            <input id="beklemeMin" type="number" min="0">
            <input id="beklemeMaks" type="number" min="0">
          </div>
        </div>
      </div>
      <div class="satir">
        <div><label>Üretim zaman aşımı (sn)</label><input id="zamanAsimi" type="number" min="1"></div>
        <div><label>Tekrar deneme</label><input id="tekrarDeneme" type="number" min="1"></div>
        <div><label>Limit beklemesi (dk)</label><input id="limitBekleme" type="number" min="1"></div>
      </div>
      <button id="btnKaydet" style="margin-top:14px">Kaydet</button>
      <span id="kaydetDurum" class="bos"></span>
    </section>
  </div>

  <div>
    <section>
      <h2>İlerleme</h2>
      <div id="ilerlemeCubuk"><div id="ilerlemeDolgu"></div></div>
      <div id="sayaclar">
        <span>Satır <b id="sayacSira">0</b>/<b id="sayacToplam">0</b></span>
        <span>Başarılı <b id="sayacBasarili">0</b></span>
        <span>Atlanan <b id="sayacAtlanan">0</b></span>
        <span>Başarısız <b id="sayacBasarisiz">0</b></span>
      </div>
      <div id="geriSayim"></div>
      <div id="kayit"></div>
    </section>

    <section>
      <h2>Galeri <button id="btnKlasor" style="float:right;font-size:13px;padding:5px 11px">Klasörü aç</button></h2>
      <div id="galeri"><p class="bos">Henüz görsel yok</p></div>
    </section>
  </div>
</main>

<script type="module">
const token = new URLSearchParams(location.search).get('t') ?? '';
const $ = (id) => document.getElementById(id);

async function api(yol, secenekler = {}) {
  const yanit = await fetch(yol, {
    ...secenekler,
    headers: { 'content-type': 'application/json', 'x-token': token, ...(secenekler.headers ?? {}) },
  });
  const govde = yanit.headers.get('content-type')?.includes('json') ? await yanit.json() : null;
  if (!yanit.ok) throw new Error(govde?.hata ?? `HTTP ${yanit.status}`);
  return govde;
}

// ---- proje formu ----
function satirlariAyristir(metin) {
  const satirlar = [];
  for (const ham of metin.split(/\r?\n/)) {
    const duz = ham.trim();
    if (duz === '') continue;
    if (/^metin\s*,\s*dosya_adi$/i.test(duz)) continue;
    const ayirac = duz.lastIndexOf(',');
    if (ayirac === -1) throw new Error(`Virgül yok: "${duz}"`);
    const metinAlan = duz.slice(0, ayirac).trim().replace(/^"|"$/g, '');
    const dosyaAdi = duz.slice(ayirac + 1).trim().replace(/\.png$/i, '');
    if (!metinAlan || !dosyaAdi) throw new Error(`Eksik alan: "${duz}"`);
    satirlar.push({ metin: metinAlan, dosyaAdi });
  }
  return satirlar;
}

function formdanProje(mevcut) {
  return {
    ...mevcut,
    basePrompt: $('basePrompt').value,
    ciktiKlasoru: $('ciktiKlasoru').value,
    satirlar: satirlariAyristir($('satirlar').value),
    ayarlar: {
      modelAdi: $('modelAdi').value,
      satirArasiBekleme: [Number($('beklemeMin').value), Number($('beklemeMaks').value)],
      uretimZamanAsimiSn: Number($('zamanAsimi').value),
      tekrarDenemeSayisi: Number($('tekrarDeneme').value),
      rateLimitVarsayilanBeklemeDk: Number($('limitBekleme').value),
    },
  };
}

let proje = null;

function projeyiYaz(p) {
  proje = p;
  $('basePrompt').value = p.basePrompt;
  $('ciktiKlasoru').value = p.ciktiKlasoru;
  $('satirlar').value = p.satirlar.map((s) => `${s.metin},${s.dosyaAdi}`).join('\n');
  $('modelAdi').value = p.ayarlar.modelAdi;
  $('beklemeMin').value = p.ayarlar.satirArasiBekleme[0];
  $('beklemeMaks').value = p.ayarlar.satirArasiBekleme[1];
  $('zamanAsimi').value = p.ayarlar.uretimZamanAsimiSn;
  $('tekrarDeneme').value = p.ayarlar.tekrarDenemeSayisi;
  $('limitBekleme').value = p.ayarlar.rateLimitVarsayilanBeklemeDk;
  onizlemeyiTazele();
}

let onizlemeZaman;
function onizlemeyiTazele() {
  clearTimeout(onizlemeZaman);
  onizlemeZaman = setTimeout(async () => {
    let satirlar = [];
    try {
      satirlar = satirlariAyristir($('satirlar').value);
      $('satirUyari').style.display = 'none';
      $('satirlar').classList.remove('hatali');
    } catch (hata) {
      $('satirUyari').textContent = hata.message;
      $('satirUyari').style.display = 'block';
      $('satirlar').classList.add('hatali');
    }
    const sonuc = await api('/api/proje/onizleme', {
      method: 'POST',
      body: JSON.stringify({ basePrompt: $('basePrompt').value, satirlar }),
    });
    $('promptUyari').style.display = sonuc.yerTutucuVar ? 'none' : 'block';
    $('basePrompt').classList.toggle('hatali', !sonuc.yerTutucuVar);
    $('btnBaslat').disabled = !sonuc.yerTutucuVar || satirlar.length === 0;

    const liste = $('onizleme');
    liste.innerHTML = '';
    if (sonuc.onizleme.length === 0) {
      liste.innerHTML = '<li class="bos">Önizleme için prompt ve satır gerekli</li>';
    } else {
      sonuc.onizleme.forEach((metin, i) => {
        const li = document.createElement('li');
        li.textContent = `${i + 1} → ${metin}`;
        liste.appendChild(li);
      });
    }
  }, 250);
}

$('basePrompt').addEventListener('input', onizlemeyiTazele);
$('satirlar').addEventListener('input', onizlemeyiTazele);

$('btnYerTutucu').addEventListener('click', () => {
  const alan = $('basePrompt');
  const konum = alan.selectionStart ?? alan.value.length;
  alan.value = alan.value.slice(0, konum) + '{VARYASYON}' + alan.value.slice(konum);
  alan.focus();
  onizlemeyiTazele();
});

$('btnKaydet').addEventListener('click', async () => {
  try {
    projeyiYaz(await api('/api/proje', { method: 'PUT', body: JSON.stringify(formdanProje(proje)) }));
    $('kaydetDurum').textContent = 'Kaydedildi';
  } catch (hata) {
    $('kaydetDurum').textContent = hata.message;
  }
  setTimeout(() => ($('kaydetDurum').textContent = ''), 3000);
});

// ---- iş kontrolü ----
$('btnBaslat').addEventListener('click', async () => {
  try {
    await api('/api/proje', { method: 'PUT', body: JSON.stringify(formdanProje(proje)) });
    await api('/api/is/baslat', { method: 'POST' });
  } catch (hata) {
    kayitEkle(`hata: ${hata.message}`);
  }
});
$('btnDuraklat').addEventListener('click', () => api('/api/is/duraklat', { method: 'POST' }));
$('btnDevam').addEventListener('click', () => api('/api/is/devam', { method: 'POST' }));
$('btnDurdur').addEventListener('click', () => api('/api/is/durdur', { method: 'POST' }));
$('btnHazir').addEventListener('click', () => api('/api/is/kullanici-hazir', { method: 'POST' }));
$('btnKlasor').addEventListener('click', () => api('/api/klasoru-ac', { method: 'POST' }));

// ---- canlı akış ----
const ETIKET = {
  bosta: 'boşta', calisiyor: 'çalışıyor', duraklatildi: 'duraklatıldı',
  limitBekliyor: 'limit bekleniyor', kullaniciBekliyor: 'sizi bekliyor',
  bitti: 'bitti', durduruldu: 'durduruldu', hata: 'hata',
};

function durumuUygula(durum) {
  $('rozet').textContent = ETIKET[durum] ?? durum;
  const calisir = ['calisiyor', 'limitBekliyor', 'kullaniciBekliyor'].includes(durum);
  $('btnBaslat').disabled = calisir || durum === 'duraklatildi';
  $('btnDuraklat').disabled = !calisir;
  $('btnDevam').disabled = durum !== 'duraklatildi';
  $('btnDurdur').disabled = !calisir && durum !== 'duraklatildi';
  if (durum !== 'kullaniciBekliyor') $('kullaniciKart').style.display = 'none';
  if (durum !== 'limitBekliyor') $('geriSayim').style.display = 'none';
}

function kayitEkle(metin) {
  const satir = document.createElement('div');
  satir.textContent = `${new Date().toLocaleTimeString('tr-TR')} ${metin}`;
  $('kayit').prepend(satir);
}

async function galeriyiTazele() {
  const { dosyalar } = await api('/api/galeri');
  const kutu = $('galeri');
  if (dosyalar.length === 0) {
    kutu.innerHTML = '<p class="bos">Henüz görsel yok</p>';
    return;
  }
  kutu.innerHTML = '';
  for (const ad of dosyalar) {
    const sekil = document.createElement('figure');
    const img = document.createElement('img');
    img.src = `/api/gorsel/${encodeURIComponent(ad)}?t=${token}`;
    img.loading = 'lazy';
    const alt = document.createElement('figcaption');
    alt.textContent = ad;
    sekil.append(img, alt);
    kutu.appendChild(sekil);
  }
}

const akis = new EventSource(`/api/is/akis?t=${token}`);
akis.onmessage = (olayVerisi) => {
  const olay = JSON.parse(olayVerisi.data);
  switch (olay.tip) {
    case 'durum':
      durumuUygula(olay.durum);
      $('sayacBasarili').textContent = olay.ozet.basarili;
      $('sayacAtlanan').textContent = olay.ozet.atlanan;
      $('sayacBasarisiz').textContent = olay.ozet.basarisiz;
      break;
    case 'satirBasladi':
      $('sayacSira').textContent = olay.sira;
      $('sayacToplam').textContent = olay.toplam;
      $('ilerlemeDolgu').style.width = `${(olay.sira / olay.toplam) * 100}%`;
      kayitEkle(`[${olay.sira}/${olay.toplam}] ${olay.dosyaAdi}`);
      break;
    case 'gorselHazir':
      galeriyiTazele();
      break;
    case 'satirBitti':
      if (olay.sonuc === 'basarisiz') kayitEkle(`başarısız: ${olay.sebep ?? ''}`);
      break;
    case 'limitBekleniyor': {
      const dk = Math.floor(olay.kalanSn / 60);
      const sn = olay.kalanSn % 60;
      $('geriSayim').style.display = 'block';
      $('geriSayim').textContent = `Rate limit — ${dk}dk ${String(sn).padStart(2, '0')}sn`;
      break;
    }
    case 'kullaniciGerekli':
      $('kullaniciMesaj').textContent = olay.mesaj;
      $('kullaniciKart').style.display = 'block';
      kayitEkle(olay.mesaj);
      break;
    case 'hata':
      kayitEkle(`hata: ${olay.mesaj}`);
      break;
    case 'bitti':
      kayitEkle(`bitti — başarılı ${olay.ozet.basarili}, atlanan ${olay.ozet.atlanan}, başarısız ${olay.ozet.basarisiz}`);
      galeriyiTazele();
      break;
  }
};

projeyiYaz(await api('/api/proje'));
durumuUygula((await api('/api/is')).durum);
galeriyiTazele();
</script>
</body>
</html>
```

- [ ] **Step 2: Run it and verify the page loads**

```bash
yarn baslat
```

Beklenen: terminalde `http://127.0.0.1:<port>/?t=<token>` yazar, varsayılan tarayıcıda sayfa açılır, form varsayılan projeyle dolu gelir, önizleme çalışır, durum rozeti "boşta" gösterir.

- [ ] **Step 3: Run the full test suite**

Run: `yarn test && yarn typecheck`
Expected: hepsi geçer

- [ ] **Step 4: Commit — ATLA**

---

## Faz 2A tamamlandı — doğrulama

```bash
yarn test        # tüm birim testler
yarn typecheck   # temiz
yarn baslat      # sayfa açılır, gerçek ChatGPT'ye karşı denenebilir
```

Bu noktada gerçek risk test edilebilir hale gelir: `src/seciciler.ts` içindeki DOM seçicileri güncel ChatGPT arayüzünde tutuyor mu?

**Faz 2B** (ekler, CSV dosya yükleme, seçici onarım ekranı, çoklu proje/geçmiş, React'e geçiş) ayrı planda.
