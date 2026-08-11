# Yerel Web UI — Faz 1: İş Yöneticisi ve İptal/Duraklat

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mevcut `worker.ts` döngüsünü, dışarıdan durdurulabilir/duraklatılabilir ve olay yayınlayan bir iş yöneticisinin altına almak.

**Architecture:** İki yeni primitif (`Kapi` = duraklatma kapısı, `uyuKesintili` = bölünebilir uyku) `worker.ts`'e enjekte edilir. `IsYoneticisi` bunları bir durum makinesine bağlar ve dinleyicilere olay yayınlar. Playwright'a hiç dokunulmaz; her şey sahte tarayıcıyla test edilir.

**Tech Stack:** TypeScript (ESM, `.js` uzantılı importlar), vitest, Node 20+.

## Global Constraints

- Tüm tanımlayıcılar Türkçe — mevcut kod tabanının kuralı (`tumSatirlariIsle`, `basarisizKaydet`).
- Import'lar `.js` uzantılı: `import { uyu } from './bekleme.js'`.
- Playwright'a dokunan tek modül `src/tarayici.ts`'dir. Bu fazda o dosyaya dokunulmaz.
- `Math.random()` ve `Date.now()` doğrudan test edilen kod yollarında kullanılmaz; test edilebilirlik için enjekte edilir.
- Her task sonunda `yarn test` ve `yarn typecheck` temiz geçmeli.
- Commit atma: **kullanıcı açıkça istemedikçe commit adımı çalıştırılmaz.** Planda commit adımı yazsa bile önce kullanıcıya sorulur.

---

### Task 1: `Kapi` — duraklatma kapısı

**Files:**
- Create: `src/is/kapi.ts`
- Test: `tests/kapi.test.ts`

**Interfaces:**
- Consumes: yok
- Produces: `class Kapi { acik(): boolean; kapat(): void; ac(): void; gec(): Promise<void> }`

`gec()` kapı açıkken hemen döner, kapalıyken `ac()` çağrılana kadar bekler. Birden fazla bekleyen olabilir; `ac()` hepsini birden serbest bırakır.

- [ ] **Step 1: Write the failing test**

```ts
// tests/kapi.test.ts
import { describe, expect, it } from 'vitest';
import { Kapi } from '../src/is/kapi.js';

describe('Kapi', () => {
  it('varsayılan olarak açıktır ve gec() hemen döner', async () => {
    const kapi = new Kapi();
    expect(kapi.acik()).toBe(true);
    await kapi.gec();
  });

  it('kapalıyken bekletir, ac() ile serbest bırakır', async () => {
    const kapi = new Kapi();
    kapi.kapat();
    expect(kapi.acik()).toBe(false);

    let gecti = false;
    const bekleyen = kapi.gec().then(() => {
      gecti = true;
    });

    await Promise.resolve();
    expect(gecti).toBe(false);

    kapi.ac();
    await bekleyen;
    expect(gecti).toBe(true);
  });

  it('birden fazla bekleyeni tek ac() ile serbest bırakır', async () => {
    const kapi = new Kapi();
    kapi.kapat();
    const bekleyenler = [kapi.gec(), kapi.gec(), kapi.gec()];
    kapi.ac();
    await Promise.all(bekleyenler);
    expect(kapi.acik()).toBe(true);
  });

  it('zaten açıkken ac() çağrısı sorun çıkarmaz', () => {
    const kapi = new Kapi();
    kapi.ac();
    expect(kapi.acik()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run tests/kapi.test.ts`
Expected: FAIL — `Failed to resolve import "../src/is/kapi.js"`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/is/kapi.ts
/** Duraklatma kapısı. Kapalıyken gec() bekletir, ac() tüm bekleyenleri serbest bırakır. */
export class Kapi {
  private kapali = false;
  private bekleyenler: Array<() => void> = [];

  acik(): boolean {
    return !this.kapali;
  }

  kapat(): void {
    this.kapali = true;
  }

  ac(): void {
    this.kapali = false;
    const cozulecekler = this.bekleyenler;
    this.bekleyenler = [];
    for (const coz of cozulecekler) coz();
  }

  gec(): Promise<void> {
    if (!this.kapali) return Promise.resolve();
    return new Promise((coz) => this.bekleyenler.push(coz));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run tests/kapi.test.ts && yarn typecheck`
Expected: 4 passed, typecheck temiz

- [ ] **Step 5: Commit (önce kullanıcıya sor)**

```bash
git add src/is/kapi.ts tests/kapi.test.ts
git commit -m "feat: duraklatma kapısı (Kapi) primitifi"
```

---

### Task 2: `uyuKesintili` — bölünebilir uyku

**Files:**
- Create: `src/is/uyku.ts`
- Test: `tests/uyku.test.ts`

**Interfaces:**
- Consumes: `Kapi` (Task 1)
- Produces:
```ts
export interface UykuSecenekleri {
  signal?: AbortSignal;
  kapi?: Kapi;
  tik?: (kalanMs: number) => void;
  adimMs?: number;              // varsayılan 1000
  uyu?: (ms: number) => Promise<void>;  // test için enjekte edilir
}
export function uyuKesintili(ms: number, secenekler?: UykuSecenekleri): Promise<void>
```

Uykuyu `adimMs` dilimlerine böler. Her dilim başında `tik(kalanMs)` çağırır, `signal.aborted` ise erken döner, `kapi` kapalıysa açılana kadar bekler. Gerçek `setTimeout` yerine enjekte edilebilir `uyu` kullanır — testler saat beklemez.

- [ ] **Step 1: Write the failing test**

```ts
// tests/uyku.test.ts
import { describe, expect, it } from 'vitest';
import { Kapi } from '../src/is/kapi.js';
import { uyuKesintili } from '../src/is/uyku.js';

/** Gerçek beklemeyen sahte uyku; çağrılan süreleri kaydeder. */
function sahteUyku() {
  const cagrilar: number[] = [];
  return {
    cagrilar,
    uyu: async (ms: number) => {
      cagrilar.push(ms);
    },
  };
}

describe('uyuKesintili', () => {
  it('süreyi adimMs dilimlerine böler', async () => {
    const s = sahteUyku();
    await uyuKesintili(3000, { adimMs: 1000, uyu: s.uyu });
    expect(s.cagrilar).toEqual([1000, 1000, 1000]);
  });

  it('son dilim kalan süre kadar olur', async () => {
    const s = sahteUyku();
    await uyuKesintili(2500, { adimMs: 1000, uyu: s.uyu });
    expect(s.cagrilar).toEqual([1000, 1000, 500]);
  });

  it('her dilim başında kalan süreyle tik çağırır', async () => {
    const s = sahteUyku();
    const kalanlar: number[] = [];
    await uyuKesintili(3000, { adimMs: 1000, uyu: s.uyu, tik: (k) => kalanlar.push(k) });
    expect(kalanlar).toEqual([3000, 2000, 1000]);
  });

  it('signal iptal edilince erken döner', async () => {
    const s = sahteUyku();
    const kontrolcu = new AbortController();
    let tikSayisi = 0;
    await uyuKesintili(60_000, {
      adimMs: 1000,
      uyu: s.uyu,
      signal: kontrolcu.signal,
      tik: () => {
        tikSayisi++;
        if (tikSayisi === 2) kontrolcu.abort();
      },
    });
    expect(s.cagrilar.length).toBeLessThan(5);
  });

  it('başlangıçta iptal edilmişse hiç uyumaz', async () => {
    const s = sahteUyku();
    const kontrolcu = new AbortController();
    kontrolcu.abort();
    await uyuKesintili(5000, { adimMs: 1000, uyu: s.uyu, signal: kontrolcu.signal });
    expect(s.cagrilar).toEqual([]);
  });

  it('kapı kapalıyken bekler, açılınca sürer', async () => {
    const s = sahteUyku();
    const kapi = new Kapi();
    kapi.kapat();

    let bitti = false;
    const calisma = uyuKesintili(1000, { adimMs: 1000, uyu: s.uyu, kapi }).then(() => {
      bitti = true;
    });

    await Promise.resolve();
    expect(bitti).toBe(false);

    kapi.ac();
    await calisma;
    expect(bitti).toBe(true);
  });

  it('sıfır veya negatif süre hemen döner', async () => {
    const s = sahteUyku();
    await uyuKesintili(0, { adimMs: 1000, uyu: s.uyu });
    expect(s.cagrilar).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run tests/uyku.test.ts`
Expected: FAIL — `Failed to resolve import "../src/is/uyku.js"`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/is/uyku.ts
import { uyu as gercekUyu } from '../bekleme.js';
import type { Kapi } from './kapi.js';

export interface UykuSecenekleri {
  signal?: AbortSignal;
  kapi?: Kapi;
  /** Her dilim başında kalan süreyle çağrılır. */
  tik?: (kalanMs: number) => void;
  /** Dilim uzunluğu; varsayılan 1 saniye. */
  adimMs?: number;
  /** Test için enjekte edilir; varsayılan gerçek setTimeout. */
  uyu?: (ms: number) => Promise<void>;
}

/**
 * Uykuyu dilimlere böler; iptal edilebilir ve duraklatılabilir.
 * 15 dakikalık rate-limit beklemesinin Durdur'a anında yanıt vermesi için gerekli.
 */
export async function uyuKesintili(ms: number, secenekler: UykuSecenekleri = {}): Promise<void> {
  const { signal, kapi, tik, adimMs = 1000, uyu = gercekUyu } = secenekler;

  let kalan = ms;
  while (kalan > 0) {
    if (signal?.aborted) return;
    if (kapi) await kapi.gec();
    if (signal?.aborted) return;

    tik?.(kalan);
    const dilim = Math.min(adimMs, kalan);
    await uyu(dilim);
    kalan -= dilim;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run tests/uyku.test.ts && yarn typecheck`
Expected: 7 passed, typecheck temiz

- [ ] **Step 5: Commit (önce kullanıcıya sor)**

```bash
git add src/is/uyku.ts tests/uyku.test.ts
git commit -m "feat: kesintili uyku (iptal + duraklat destekli)"
```

---

### Task 3: `worker.ts` — kontrol ve satır olayları

**Files:**
- Modify: `src/worker.ts` (tamamı — arayüz ve döngü)
- Modify: `tests/worker.test.ts:48-74` (`bagimliliklar` yardımcısı) ve yeni testler
- Test: `tests/worker.test.ts`

**Interfaces:**
- Consumes: `Kapi` (Task 1)
- Produces:
```ts
export type UykuSebebi = 'satirArasi' | 'rateLimit';

export interface IsKontrolu {
  signal: AbortSignal;
  kapi: Kapi;
}

export interface WorkerBagimliliklari {
  config: Config;
  tarayici: UretimTarayicisi;
  logger: Logger;
  kontrol: IsKontrolu;
  uyu: (ms: number, sebep: UykuSebebi) => Promise<void>;
  tamamlandiMi: (dosyaAdi: string) => boolean;
  basarisizKaydet: (satir: Satir, sebep: string) => void;
  kullanicidanDevamBekle: (mesaj: string) => Promise<void>;
  satirBasladi: (sira: number, toplam: number, satir: Satir) => void;
  satirBitti: (sira: number, sonuc: 'basarili' | 'atlandi' | 'basarisiz', sebep?: string) => void;
}

export function tumSatirlariIsle(b: WorkerBagimliliklari, satirlar: Satir[]): Promise<IslemOzeti>
```

**Neden bu sınır:** `uyu`'ya `sebep` geçilmesi worker'ın olay tiplerini bilmesini engeller. Rate-limit geri sayımını SSE'ye çeviren taraf `IsYoneticisi`'dir (Task 4); worker sadece "niye uyuduğunu" söyler.

- [ ] **Step 1: Write the failing tests**

Mevcut `tests/worker.test.ts` içindeki `bagimliliklar` yardımcısını değiştir (satır 48-74 yerine):

```ts
function bagimliliklar(
  tarayici: UretimTarayicisi,
  ek: Partial<WorkerBagimliliklari> = {},
): WorkerBagimliliklari & {
  basarisizlar: string[];
  beklemeler: Array<{ ms: number; sebep: UykuSebebi }>;
  onaylar: string[];
  olaylar: string[];
  kontrolcu: AbortController;
} {
  const basarisizlar: string[] = [];
  const beklemeler: Array<{ ms: number; sebep: UykuSebebi }> = [];
  const onaylar: string[] = [];
  const olaylar: string[] = [];
  const kontrolcu = new AbortController();
  return {
    config: CONFIG,
    tarayici,
    logger: { bilgi: vi.fn(), uyari: vi.fn(), hata: vi.fn() } as never,
    kontrol: { signal: kontrolcu.signal, kapi: new Kapi() },
    uyu: async (ms: number, sebep: UykuSebebi) => {
      beklemeler.push({ ms, sebep });
    },
    tamamlandiMi: () => false,
    basarisizKaydet: (satir: Satir, sebep: string) => {
      basarisizlar.push(`${satir.dosyaAdi}: ${sebep}`);
    },
    kullanicidanDevamBekle: async (mesaj: string) => {
      onaylar.push(mesaj);
    },
    satirBasladi: (sira, _toplam, satir) => olaylar.push(`basladi:${sira}:${satir.dosyaAdi}`),
    satirBitti: (sira, sonuc) => olaylar.push(`bitti:${sira}:${sonuc}`),
    basarisizlar,
    beklemeler,
    onaylar,
    olaylar,
    kontrolcu,
    ...ek,
  };
}
```

Dosyanın başına ekle:

```ts
import { Kapi } from '../src/is/kapi.js';
import { tumSatirlariIsle, type UykuSebebi, type WorkerBagimliliklari } from '../src/worker.js';
```

Mevcut testlerde `b.beklemeler` kullanan iki assertion güncellenir:

```ts
// "rate limit gelince mesajdaki süre kadar uyur" testinde:
expect(b.beklemeler).toContainEqual({ ms: 25 * 60_000, sebep: 'rateLimit' });

// "süre belirtilmeyen rate limitte varsayılan süre uyur" testinde:
expect(b.beklemeler).toContainEqual({ ms: 15 * 60_000, sebep: 'rateLimit' });
```

Ve `describe` bloğunun sonuna yeni testler:

```ts
  it('durdurulunca kalan satırları işlemez', async () => {
    const { tarayici, cagrilar } = sahteTarayici();
    const b = bagimliliklar(tarayici);
    b.kontrolcu.abort();
    const ozet = await tumSatirlariIsle(b, [SATIR, { metin: 'plajda', dosyaAdi: 'plaj' }]);
    expect(ozet).toEqual({ basarili: 0, atlanan: 0, basarisiz: 0 });
    expect(cagrilar).not.toContain('uret');
  });

  it('ilk satırdan sonra durdurulunca ikinciyi işlemez', async () => {
    const { tarayici, cagrilar } = sahteTarayici({ sonuclar: [{ tip: 'gorsel' }] });
    const b = bagimliliklar(tarayici, {
      satirBitti: () => {},
    });
    const orijinalUyu = b.uyu;
    b.uyu = async (ms, sebep) => {
      b.kontrolcu.abort();
      await orijinalUyu(ms, sebep);
    };
    const ozet = await tumSatirlariIsle(b, [SATIR, { metin: 'plajda', dosyaAdi: 'plaj' }]);
    expect(ozet.basarili).toBe(1);
    expect(cagrilar.filter((c) => c === 'uret')).toHaveLength(1);
  });

  it('duraklatılmışken satır başlatmaz, devam edince sürer', async () => {
    const { tarayici, cagrilar } = sahteTarayici({ sonuclar: [{ tip: 'gorsel' }] });
    const kapi = new Kapi();
    const kontrolcu = new AbortController();
    const b = bagimliliklar(tarayici, { kontrol: { signal: kontrolcu.signal, kapi } });
    kapi.kapat();

    let bitti = false;
    const calisma = tumSatirlariIsle(b, [SATIR]).then(() => {
      bitti = true;
    });

    await Promise.resolve();
    expect(cagrilar).not.toContain('uret');
    expect(bitti).toBe(false);

    kapi.ac();
    await calisma;
    expect(cagrilar).toContain('uret');
  });

  it('satır başladı ve bitti olaylarını sırayla yayınlar', async () => {
    const { tarayici } = sahteTarayici({ sonuclar: [{ tip: 'gorsel' }] });
    const b = bagimliliklar(tarayici);
    await tumSatirlariIsle(b, [SATIR]);
    expect(b.olaylar).toEqual(['basladi:1:kedi_kar', 'bitti:1:basarili']);
  });

  it('atlanan satır için atlandı olayı yayınlar', async () => {
    const { tarayici } = sahteTarayici();
    const b = bagimliliklar(tarayici, { tamamlandiMi: () => true });
    await tumSatirlariIsle(b, [SATIR]);
    expect(b.olaylar).toEqual(['bitti:1:atlandi']);
  });

  it('satır arası beklemeyi satirArasi sebebiyle yapar', async () => {
    const { tarayici } = sahteTarayici({ sonuclar: [{ tip: 'gorsel' }] });
    const b = bagimliliklar(tarayici, { config: { ...CONFIG, satirArasiBekleme: [2, 2] } });
    await tumSatirlariIsle(b, [SATIR]);
    expect(b.beklemeler).toContainEqual({ ms: 2000, sebep: 'satirArasi' });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run tests/worker.test.ts`
Expected: FAIL — `kontrol` alanı `WorkerBagimliliklari` üzerinde yok, `satirBasladi` tanımsız

- [ ] **Step 3: Write the implementation**

`src/worker.ts` tamamını değiştir:

```ts
import { rastgeleSureMs } from './bekleme.js';
import { ciktiYolu } from './durum.js';
import type { Kapi } from './is/kapi.js';
import type { Logger } from './logger.js';
import { promptOlustur } from './prompt.js';
import { rateLimitAlgila } from './rateLimit.js';
import type { Config, IslemOzeti, Satir, UretimTarayicisi } from './tipler.js';

export type UykuSebebi = 'satirArasi' | 'rateLimit';

export interface IsKontrolu {
  signal: AbortSignal;
  kapi: Kapi;
}

export interface WorkerBagimliliklari {
  config: Config;
  tarayici: UretimTarayicisi;
  logger: Logger;
  kontrol: IsKontrolu;
  uyu: (ms: number, sebep: UykuSebebi) => Promise<void>;
  tamamlandiMi: (dosyaAdi: string) => boolean;
  basarisizKaydet: (satir: Satir, sebep: string) => void;
  kullanicidanDevamBekle: (mesaj: string) => Promise<void>;
  satirBasladi: (sira: number, toplam: number, satir: Satir) => void;
  satirBitti: (sira: number, sonuc: 'basarili' | 'atlandi' | 'basarisiz', sebep?: string) => void;
}

export async function tumSatirlariIsle(b: WorkerBagimliliklari, satirlar: Satir[]): Promise<IslemOzeti> {
  const ozet: IslemOzeti = { basarili: 0, atlanan: 0, basarisiz: 0 };

  for (const [sira, satir] of satirlar.entries()) {
    if (b.kontrol.signal.aborted) break;
    await b.kontrol.kapi.gec();
    if (b.kontrol.signal.aborted) break;

    const sıraNo = sira + 1;

    if (b.tamamlandiMi(satir.dosyaAdi)) {
      b.logger.bilgi(`[${sıraNo}/${satirlar.length}] atlandı (zaten var): ${satir.dosyaAdi}.png`);
      ozet.atlanan++;
      b.satirBitti(sıraNo, 'atlandi');
      continue;
    }

    b.logger.bilgi(`[${sıraNo}/${satirlar.length}] işleniyor: ${satir.dosyaAdi}`);
    b.satirBasladi(sıraNo, satirlar.length, satir);

    const sonuc = await satiriIsle(b, satir);
    if (sonuc.basarili) {
      ozet.basarili++;
      b.satirBitti(sıraNo, 'basarili');
    } else {
      ozet.basarisiz++;
      b.satirBitti(sıraNo, 'basarisiz', sonuc.sebep);
    }

    await b.uyu(rastgeleSureMs(b.config.satirArasiBekleme), 'satirArasi');
  }

  return ozet;
}

interface SatirSonucu {
  basarili: boolean;
  sebep?: string;
}

async function satiriIsle(b: WorkerBagimliliklari, satir: Satir): Promise<SatirSonucu> {
  const prompt = promptOlustur(b.config.basePrompt, satir.metin);
  let deneme = 0;

  while (deneme < b.config.tekrarDenemeSayisi) {
    if (b.kontrol.signal.aborted) return { basarili: false, sebep: 'durduruldu' };
    await b.kontrol.kapi.gec();
    if (b.kontrol.signal.aborted) return { basarili: false, sebep: 'durduruldu' };

    try {
      await b.tarayici.yeniSohbetAc();

      if (!(await b.tarayici.oturumAcikMi())) {
        b.logger.uyari('oturum kapalı görünüyor; kullanıcı girişi bekleniyor');
        await b.kullanicidanDevamBekle(
          'ChatGPT oturumu kapalı. Açılan tarayıcıda elle giriş yapın, sonra Devam edin.',
        );
        continue; // deneme hakkı yakılmaz
      }

      if (b.config.modelAdi !== '') {
        const aktifModel = await b.tarayici.aktifModelAdi();
        if (!aktifModel.toLowerCase().includes(b.config.modelAdi.toLowerCase())) {
          b.logger.uyari(`beklenen model "${b.config.modelAdi}", aktif model "${aktifModel}"`);
          await b.kullanicidanDevamBekle(
            `Yanlış model seçili (aktif: "${aktifModel}", beklenen: "${b.config.modelAdi}"). ` +
              'Tarayıcıdan doğru modeli seçin, sonra Devam edin.',
          );
          continue; // deneme hakkı yakılmaz
        }
      }

      const sonuc = await b.tarayici.gorselUret(prompt, b.config.uretimZamanAsimiSn);

      switch (sonuc.tip) {
        case 'gorsel': {
          await b.tarayici.sonGorseliKaydet(ciktiYolu(b.config.ciktiKlasoru, satir.dosyaAdi));
          b.logger.bilgi(`kaydedildi: ${satir.dosyaAdi}.png`);
          return { basarili: true };
        }
        case 'rateLimit': {
          const dk = rateLimitAlgila(sonuc.mesaj).beklemeDk ?? b.config.rateLimitVarsayilanBeklemeDk;
          b.logger.uyari(`rate limit algılandı; ${dk} dk bekleniyor (satır: ${satir.dosyaAdi})`);
          await b.uyu(dk * 60_000, 'rateLimit');
          continue; // aynı satır, deneme hakkı yakılmaz
        }
        case 'red': {
          const sebep = `içerik reddi: ${sonuc.mesaj.slice(0, 200)}`;
          b.logger.uyari(`${sebep} (satır: ${satir.dosyaAdi})`);
          b.basarisizKaydet(satir, sebep);
          return { basarili: false, sebep };
        }
        case 'zamanAsimi': {
          deneme++;
          b.logger.uyari(`üretim zaman aşımı (${deneme}/${b.config.tekrarDenemeSayisi}): ${satir.dosyaAdi}`);
          break;
        }
      }
    } catch (hata) {
      deneme++;
      b.logger.hata(
        `tarayıcı hatası (${deneme}/${b.config.tekrarDenemeSayisi}): ${(hata as Error).message}; yeniden başlatılıyor`,
      );
      await b.tarayici.yenidenBaslat();
    }
  }

  const sebep = `tekrar deneme sayısı aşıldı (${b.config.tekrarDenemeSayisi})`;
  b.basarisizKaydet(satir, sebep);
  return { basarili: false, sebep };
}
```

**Dikkat:** `main.ts` artık derlenmez (`kontrol`, `satirBasladi`, `satirBitti` eksik ve `uyu` imzası değişti). Spec §4 gereği `main.ts` kaldırılıyor — bu adımda sil:

```bash
git rm src/main.ts
```

`package.json`'daki `"baslat": "tsx src/main.ts"` script'i Faz 2 Task 13'te `src/baslat.ts`'ye bağlanacak. Şimdilik sil:

```json
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test && yarn typecheck`
Expected: `tests/worker.test.ts` 15 passed (9 mevcut + 6 yeni), toplam **55 passed**, typecheck temiz

- [ ] **Step 5: Commit (önce kullanıcıya sor)**

```bash
git add src/worker.ts tests/worker.test.ts package.json
git commit -m "feat: worker'a iptal/duraklat kontrolü ve satır olayları"
```

---

### Task 4: `IsYoneticisi` — durum makinesi ve olay yayını

**Files:**
- Create: `src/is/olaylar.ts`
- Create: `src/is/isYoneticisi.ts`
- Test: `tests/isYoneticisi.test.ts`

**Interfaces:**
- Consumes: `Kapi` (Task 1), `uyuKesintili` (Task 2), `tumSatirlariIsle` / `WorkerBagimliliklari` / `UykuSebebi` (Task 3)
- Produces:
```ts
// src/is/olaylar.ts
export type IsDurumu =
  | 'bosta' | 'calisiyor' | 'duraklatildi' | 'limitBekliyor'
  | 'kullaniciBekliyor' | 'bitti' | 'durduruldu' | 'hata';

export type IsOlayi =
  | { tip: 'durum'; durum: IsDurumu; projeId: string | null; ozet: IslemOzeti }
  | { tip: 'satirBasladi'; sira: number; toplam: number; dosyaAdi: string }
  | { tip: 'gorselHazir'; dosyaAdi: string }
  | { tip: 'satirBitti'; sira: number; sonuc: 'basarili' | 'atlandi' | 'basarisiz'; sebep?: string }
  | { tip: 'limitBekleniyor'; kalanSn: number }
  | { tip: 'kullaniciGerekli'; mesaj: string }
  | { tip: 'hata'; mesaj: string }
  | { tip: 'bitti'; ozet: IslemOzeti };

// src/is/isYoneticisi.ts
export interface IsBilgisi {
  durum: IsDurumu;
  projeId: string | null;
  ozet: IslemOzeti;
  sira: number;
  toplam: number;
}

export interface IsAyarlari {
  projeId: string;
  config: Config;
  satirlar: Satir[];
  tarayici: UretimTarayicisi;
  logger: Logger;
  tamamlandiMi: (dosyaAdi: string) => boolean;
  basarisizKaydet: (satir: Satir, sebep: string) => void;
  /** Test için enjekte edilir; varsayılan uyuKesintili. */
  uyuMotoru?: (ms: number, secenekler: UykuSecenekleri) => Promise<void>;
}

export class IsYoneticisi {
  bilgi(): IsBilgisi;
  dinle(dinleyici: (olay: IsOlayi) => void): () => void;
  baslat(ayarlar: IsAyarlari): Promise<IslemOzeti>;
  duraklat(): void;
  devam(): void;
  durdur(): void;
  kullaniciHazir(): void;
}
```

**Durum geçişleri:** `baslat` → `calisiyor`. `duraklat` → `duraklatildi` (kapıyı kapatır). `devam` → `calisiyor` (kapıyı açar). `durdur` → `durduruldu` (signal abort + kapıyı açar ki bekleyen çözülsün). Rate-limit uykusu sırasında `limitBekliyor`, bitince `calisiyor`. `kullanicidanDevamBekle` çağrılınca `kullaniciBekliyor`, `kullaniciHazir()` ile `calisiyor`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/isYoneticisi.test.ts
import { describe, expect, it, vi } from 'vitest';
import { IsYoneticisi } from '../src/is/isYoneticisi.js';
import type { IsOlayi } from '../src/is/olaylar.js';
import type { Config, GorselSonucu, Satir, UretimTarayicisi } from '../src/tipler.js';

const CONFIG: Config = {
  basePrompt: 'Bir kedi, {VARYASYON}',
  ciktiKlasoru: '/tmp/cikti',
  chromeProfil: '/tmp/profil',
  modelAdi: '',
  satirArasiBekleme: [0, 0],
  uretimZamanAsimiSn: 1,
  tekrarDenemeSayisi: 3,
  rateLimitVarsayilanBeklemeDk: 15,
};

const SATIRLAR: Satir[] = [
  { metin: 'karda', dosyaAdi: 'kedi_kar' },
  { metin: 'plajda', dosyaAdi: 'kedi_plaj' },
];

function sahteTarayici(sonuclar: GorselSonucu[] = []): UretimTarayicisi {
  const kuyruk = [...sonuclar];
  return {
    baslat: async () => {},
    yenidenBaslat: async () => {},
    yeniSohbetAc: async () => {},
    oturumAcikMi: async () => true,
    aktifModelAdi: async () => 'GPT-5',
    gorselUret: async () => kuyruk.shift() ?? { tip: 'gorsel' },
    sonGorseliKaydet: async () => {},
    kapat: async () => {},
  };
}

function ayarlar(ek: Partial<Parameters<IsYoneticisi['baslat']>[0]> = {}) {
  return {
    projeId: 'proje-1',
    config: CONFIG,
    satirlar: SATIRLAR,
    tarayici: sahteTarayici(),
    logger: { bilgi: vi.fn(), uyari: vi.fn(), hata: vi.fn() } as never,
    tamamlandiMi: () => false,
    basarisizKaydet: () => {},
    uyuMotoru: async () => {},
    ...ek,
  };
}

describe('IsYoneticisi', () => {
  it('başlangıçta bosta durumundadır', () => {
    const y = new IsYoneticisi();
    expect(y.bilgi().durum).toBe('bosta');
    expect(y.bilgi().projeId).toBeNull();
  });

  it('iş bitince bitti durumuna geçer ve özet yayınlar', async () => {
    const y = new IsYoneticisi();
    const olaylar: IsOlayi[] = [];
    y.dinle((o) => olaylar.push(o));

    const ozet = await y.baslat(ayarlar());

    expect(ozet).toEqual({ basarili: 2, atlanan: 0, basarisiz: 0 });
    expect(y.bilgi().durum).toBe('bitti');
    expect(olaylar.at(-1)).toEqual({ tip: 'bitti', ozet });
  });

  it('satır olaylarını ve görselHazır olayını yayınlar', async () => {
    const y = new IsYoneticisi();
    const olaylar: IsOlayi[] = [];
    y.dinle((o) => olaylar.push(o));

    await y.baslat(ayarlar({ satirlar: [SATIRLAR[0]] }));

    const tipler = olaylar.map((o) => o.tip);
    expect(tipler).toContain('satirBasladi');
    expect(tipler).toContain('gorselHazir');
    expect(tipler).toContain('satirBitti');
  });

  it('durdur çağrısı işi durduruldu durumuna alır', async () => {
    const y = new IsYoneticisi();
    const calisma = y.baslat(
      ayarlar({
        uyuMotoru: async () => {
          y.durdur();
        },
      }),
    );
    const ozet = await calisma;
    expect(y.bilgi().durum).toBe('durduruldu');
    expect(ozet.basarili).toBe(1);
  });

  it('duraklat ve devam durumu değiştirir', async () => {
    const y = new IsYoneticisi();
    let duraklatildi = false;
    const calisma = y.baslat(
      ayarlar({
        uyuMotoru: async () => {
          if (!duraklatildi) {
            duraklatildi = true;
            y.duraklat();
            expect(y.bilgi().durum).toBe('duraklatildi');
            setTimeout(() => y.devam(), 0);
          }
        },
      }),
    );
    await calisma;
    expect(y.bilgi().durum).toBe('bitti');
  });

  it('rate limit uykusunda limitBekliyor durumuna geçer ve geri sayım yayınlar', async () => {
    const y = new IsYoneticisi();
    const olaylar: IsOlayi[] = [];
    y.dinle((o) => olaylar.push(o));

    await y.baslat(
      ayarlar({
        satirlar: [SATIRLAR[0]],
        tarayici: sahteTarayici([{ tip: 'rateLimit', mesaj: 'Try again in 2 minutes.' }, { tip: 'gorsel' }]),
        uyuMotoru: async (_ms, secenekler) => {
          secenekler.tik?.(120_000);
        },
      }),
    );

    expect(olaylar).toContainEqual({ tip: 'limitBekleniyor', kalanSn: 120 });
  });

  it('oturum düşünce kullaniciBekliyor durumunda kalır, kullaniciHazir ile sürer', async () => {
    let oturumAcik = false;
    const tarayici = sahteTarayici();
    tarayici.oturumAcikMi = async () => oturumAcik;

    const y = new IsYoneticisi();
    const olaylar: IsOlayi[] = [];
    y.dinle((o) => {
      olaylar.push(o);
      if (o.tip === 'kullaniciGerekli') {
        oturumAcik = true;
        setTimeout(() => y.kullaniciHazir(), 0);
      }
    });

    await y.baslat(ayarlar({ satirlar: [SATIRLAR[0]], tarayici }));

    expect(olaylar.some((o) => o.tip === 'kullaniciGerekli')).toBe(true);
    expect(y.bilgi().durum).toBe('bitti');
  });

  it('aynı anda ikinci iş başlatmayı reddeder', async () => {
    const y = new IsYoneticisi();
    let cozucu: (() => void) | undefined;
    const calisma = y.baslat(
      ayarlar({
        uyuMotoru: () => new Promise<void>((coz) => (cozucu = coz)),
      }),
    );

    await Promise.resolve();
    await expect(y.baslat(ayarlar())).rejects.toThrow('zaten çalışıyor');

    cozucu?.();
    y.durdur();
    await calisma;
  });

  it('beklenmeyen hatada hata durumuna geçer ve hata olayı yayınlar', async () => {
    const tarayici = sahteTarayici();
    tarayici.yeniSohbetAc = async () => {
      throw new Error('çöktü');
    };
    tarayici.yenidenBaslat = async () => {
      throw new Error('yeniden başlatılamadı');
    };

    const y = new IsYoneticisi();
    const olaylar: IsOlayi[] = [];
    y.dinle((o) => olaylar.push(o));

    await expect(y.baslat(ayarlar({ tarayici }))).rejects.toThrow();
    expect(y.bilgi().durum).toBe('hata');
    expect(olaylar.some((o) => o.tip === 'hata')).toBe(true);
  });

  it('dinle() geri döndürdüğü fonksiyonla aboneliği iptal eder', async () => {
    const y = new IsYoneticisi();
    const olaylar: IsOlayi[] = [];
    const iptal = y.dinle((o) => olaylar.push(o));
    iptal();
    await y.baslat(ayarlar({ satirlar: [SATIRLAR[0]] }));
    expect(olaylar).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run tests/isYoneticisi.test.ts`
Expected: FAIL — `Failed to resolve import "../src/is/isYoneticisi.js"`

- [ ] **Step 3: Write the implementation**

```ts
// src/is/olaylar.ts
import type { IslemOzeti } from '../tipler.js';

export type IsDurumu =
  | 'bosta'
  | 'calisiyor'
  | 'duraklatildi'
  | 'limitBekliyor'
  | 'kullaniciBekliyor'
  | 'bitti'
  | 'durduruldu'
  | 'hata';

export type IsOlayi =
  | { tip: 'durum'; durum: IsDurumu; projeId: string | null; ozet: IslemOzeti }
  | { tip: 'satirBasladi'; sira: number; toplam: number; dosyaAdi: string }
  | { tip: 'gorselHazir'; dosyaAdi: string }
  | { tip: 'satirBitti'; sira: number; sonuc: 'basarili' | 'atlandi' | 'basarisiz'; sebep?: string }
  | { tip: 'limitBekleniyor'; kalanSn: number }
  | { tip: 'kullaniciGerekli'; mesaj: string }
  | { tip: 'hata'; mesaj: string }
  | { tip: 'bitti'; ozet: IslemOzeti };
```

```ts
// src/is/isYoneticisi.ts
import type { Logger } from '../logger.js';
import type { Config, IslemOzeti, Satir, UretimTarayicisi } from '../tipler.js';
import { tumSatirlariIsle, type UykuSebebi } from '../worker.js';
import { Kapi } from './kapi.js';
import type { IsDurumu, IsOlayi } from './olaylar.js';
import { uyuKesintili, type UykuSecenekleri } from './uyku.js';

export interface IsBilgisi {
  durum: IsDurumu;
  projeId: string | null;
  ozet: IslemOzeti;
  sira: number;
  toplam: number;
}

export interface IsAyarlari {
  projeId: string;
  config: Config;
  satirlar: Satir[];
  tarayici: UretimTarayicisi;
  logger: Logger;
  tamamlandiMi: (dosyaAdi: string) => boolean;
  basarisizKaydet: (satir: Satir, sebep: string) => void;
  /** Test için enjekte edilir; varsayılan uyuKesintili. */
  uyuMotoru?: (ms: number, secenekler: UykuSecenekleri) => Promise<void>;
}

const BOS_OZET: IslemOzeti = { basarili: 0, atlanan: 0, basarisiz: 0 };

export class IsYoneticisi {
  private durumu: IsDurumu = 'bosta';
  private projeId: string | null = null;
  private ozet: IslemOzeti = { ...BOS_OZET };
  private sira = 0;
  private toplam = 0;

  private kontrolcu = new AbortController();
  private kapi = new Kapi();
  private kullaniciCozucu: (() => void) | null = null;
  private dinleyiciler = new Set<(olay: IsOlayi) => void>();

  bilgi(): IsBilgisi {
    return {
      durum: this.durumu,
      projeId: this.projeId,
      ozet: { ...this.ozet },
      sira: this.sira,
      toplam: this.toplam,
    };
  }

  dinle(dinleyici: (olay: IsOlayi) => void): () => void {
    this.dinleyiciler.add(dinleyici);
    return () => this.dinleyiciler.delete(dinleyici);
  }

  async baslat(ayarlar: IsAyarlari): Promise<IslemOzeti> {
    if (this.calisiyorMu()) throw new Error('bir iş zaten çalışıyor');

    this.kontrolcu = new AbortController();
    this.kapi = new Kapi();
    this.kullaniciCozucu = null;
    this.projeId = ayarlar.projeId;
    this.ozet = { ...BOS_OZET };
    this.sira = 0;
    this.toplam = ayarlar.satirlar.length;
    this.durumDegistir('calisiyor');

    const uyuMotoru = ayarlar.uyuMotoru ?? uyuKesintili;

    try {
      const ozet = await tumSatirlariIsle(
        {
          config: ayarlar.config,
          tarayici: ayarlar.tarayici,
          logger: ayarlar.logger,
          kontrol: { signal: this.kontrolcu.signal, kapi: this.kapi },
          uyu: (ms, sebep) => this.uyuVeYayinla(uyuMotoru, ms, sebep),
          tamamlandiMi: ayarlar.tamamlandiMi,
          basarisizKaydet: ayarlar.basarisizKaydet,
          kullanicidanDevamBekle: (mesaj) => this.kullaniciyiBekle(mesaj),
          satirBasladi: (sira, toplam, satir) => {
            this.sira = sira;
            this.toplam = toplam;
            this.yayinla({ tip: 'satirBasladi', sira, toplam, dosyaAdi: satir.dosyaAdi });
          },
          satirBitti: (sira, sonuc, sebep) => {
            if (sonuc === 'basarili') this.ozet.basarili++;
            else if (sonuc === 'atlandi') this.ozet.atlanan++;
            else this.ozet.basarisiz++;

            if (sonuc === 'basarili') {
              const satir = ayarlar.satirlar[sira - 1];
              if (satir) this.yayinla({ tip: 'gorselHazir', dosyaAdi: satir.dosyaAdi });
            }
            this.yayinla({ tip: 'satirBitti', sira, sonuc, sebep });
          },
        },
        ayarlar.satirlar,
      );

      this.ozet = ozet;
      this.durumDegistir(this.kontrolcu.signal.aborted ? 'durduruldu' : 'bitti');
      this.yayinla({ tip: 'bitti', ozet });
      return ozet;
    } catch (hata) {
      const mesaj = (hata as Error).message;
      this.durumDegistir('hata');
      this.yayinla({ tip: 'hata', mesaj });
      throw hata;
    }
  }

  duraklat(): void {
    if (this.durumu !== 'calisiyor' && this.durumu !== 'limitBekliyor') return;
    this.kapi.kapat();
    this.durumDegistir('duraklatildi');
  }

  devam(): void {
    if (this.durumu !== 'duraklatildi') return;
    this.kapi.ac();
    this.durumDegistir('calisiyor');
  }

  durdur(): void {
    if (!this.calisiyorMu()) return;
    this.kontrolcu.abort();
    this.kapi.ac(); // bekleyenler çözülsün ki döngü abort'u görebilsin
    this.kullaniciCozucu?.();
    this.kullaniciCozucu = null;
  }

  kullaniciHazir(): void {
    if (this.durumu !== 'kullaniciBekliyor') return;
    const coz = this.kullaniciCozucu;
    this.kullaniciCozucu = null;
    this.durumDegistir('calisiyor');
    coz?.();
  }

  private calisiyorMu(): boolean {
    return ['calisiyor', 'duraklatildi', 'limitBekliyor', 'kullaniciBekliyor'].includes(this.durumu);
  }

  private async uyuVeYayinla(
    motor: (ms: number, secenekler: UykuSecenekleri) => Promise<void>,
    ms: number,
    sebep: UykuSebebi,
  ): Promise<void> {
    const rateLimit = sebep === 'rateLimit';
    if (rateLimit) this.durumDegistir('limitBekliyor');

    await motor(ms, {
      signal: this.kontrolcu.signal,
      kapi: this.kapi,
      tik: rateLimit
        ? (kalanMs) => this.yayinla({ tip: 'limitBekleniyor', kalanSn: Math.round(kalanMs / 1000) })
        : undefined,
    });

    if (rateLimit && this.durumu === 'limitBekliyor') this.durumDegistir('calisiyor');
  }

  private kullaniciyiBekle(mesaj: string): Promise<void> {
    if (this.kontrolcu.signal.aborted) return Promise.resolve();
    this.durumDegistir('kullaniciBekliyor');
    this.yayinla({ tip: 'kullaniciGerekli', mesaj });
    return new Promise<void>((coz) => {
      this.kullaniciCozucu = coz;
    });
  }

  private durumDegistir(durum: IsDurumu): void {
    this.durumu = durum;
    this.yayinla({ tip: 'durum', durum, projeId: this.projeId, ozet: { ...this.ozet } });
  }

  private yayinla(olay: IsOlayi): void {
    for (const dinleyici of this.dinleyiciler) dinleyici(olay);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test && yarn typecheck`
Expected: `tests/isYoneticisi.test.ts` 10 passed, toplam **65 passed**, typecheck temiz

- [ ] **Step 5: Commit (önce kullanıcıya sor)**

```bash
git add src/is/olaylar.ts src/is/isYoneticisi.ts tests/isYoneticisi.test.ts
git commit -m "feat: iş yöneticisi durum makinesi ve olay yayını"
```

---

## Faz 1 Tamamlandı — Doğrulama

Bu noktada:

```bash
yarn test        # 65 passed (38 mevcut + 27 yeni: Kapi 4, uyku 7, worker 6, isYoneticisi 10)
yarn typecheck   # temiz
```

`src/main.ts` silinmiş, `src/is/` altında 4 yeni modül var, Playwright'a hiç dokunulmadı.

**Faz 2** (depo, sunucu, SSE, UI) ayrı bir planda: `docs/superpowers/plans/2026-08-11-yerel-web-ui-faz2.md`
