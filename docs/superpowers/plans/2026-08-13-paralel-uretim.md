# Paralel Üretim (N Sekme) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seçili projenin satırları, tek sekmede sırayla değil, aynı Chromium
context'inde N eş zamanlı sekmede üretilsin; N proje ayarı olsun (1-4,
varsayılan 1).

**Architecture:** Paylaşılan kuyruk üstünde N bağımsız async işçi. `worker.ts`
tek `for` döngüsü yerine `Promise.all` ile N `birIsciCalistir` koşturur;
satırlar `await` içermeyen (dolayısıyla Node'da atomik) bir imleç
fonksiyonundan çekilir. Rate limit, kullanıcı müdahalesi ve tarayıcı yeniden
başlatma için `IsYoneticisi`'nde üç adet `Kapi` + `TekYurutuc` çifti var:
"ilk gören yapar, diğerleri bekler". Bu sarmalama tamamen `IsYoneticisi`'nde
olduğu için `satiriIsle`'nin mantığı tek satır bile değişmiyor.

**Tech Stack:** TypeScript (ESM, `type: module`), Node 20+, Playwright
(chromium), Fastify 5, Vitest 4, `tsx`. Arayüz `web/` altında derleme adımı
olmayan yerel ES modülleri.

**Spec:** `docs/superpowers/specs/2026-08-13-paralel-uretim-design.md`

## Global Constraints

- **Dil:** Kod, tip adları, değişkenler, yorumlar ve commit mesajları
  **Türkçe**. Mevcut kod böyle; İngilizce isim eklenmeyecek.
- **Yeni bağımlılık yok.** `package.json` değişmiyor.
- **Playwright yalıtımı:** `playwright` paketini import eden **tek** modül
  `src/tarayici.ts` olmaya devam edecek. `depo`, `sunucu`, `worker`, `is`
  katmanları onu hiç import etmez.
- **`web/` için birim test altyapısı yok.** `web/` altındaki değişiklikler
  elle doğrulanır (Task 8).
- **Her task sonunda yeşil ağaç:** `yarn test` ve `yarn typecheck` ikisi de
  geçmeden task bitmiş sayılmaz.
- **`esZamanliSekme` geçerli aralığı: 1-4 tam sayı, varsayılan 1.** Bu üç
  değer spec §4'ten birebir; doğrulama, UI `min`/`max` ve README aynı değerleri
  kullanmalı.
- **Commit izni:** Bu depoda commit atmadan önce kullanıcıdan onay alınır.
  Task'ların son adımındaki `git commit` komutları hazırdır ama onay gelmeden
  çalıştırılmaz.

---

### Task 1: `TekYurutuc` — "ilk gören yapar" ilkeli

**Files:**
- Create: `src/is/tekYurutuc.ts`
- Test: `tests/tekYurutuc.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `export class TekYurutuc { yurut(is: () => Promise<void>): Promise<void> }`
  — Task 6 bunu üç kez örnekler (limit, kullanıcı, yeniden başlatma).

- [ ] **Step 1: Write the failing test**

`tests/tekYurutuc.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TekYurutuc } from '../src/is/tekYurutuc.js';

/** Elle çözülebilen promise — zamanlamayı testin kontrolüne verir. */
function ertelenmis() {
  let coz!: () => void;
  let reddet!: (hata: Error) => void;
  const promise = new Promise<void>((c, r) => {
    coz = c;
    reddet = r;
  });
  return { promise, coz, reddet };
}

describe('TekYurutuc', () => {
  it('aynı anda gelen iki çağrı işi yalnızca bir kez çalıştırır', async () => {
    const yurutuc = new TekYurutuc();
    const kapi = ertelenmis();
    let sayac = 0;
    const is = () => {
      sayac++;
      return kapi.promise;
    };

    const birinci = yurutuc.yurut(is);
    const ikinci = yurutuc.yurut(is);

    expect(sayac).toBe(1);
    kapi.coz();
    await Promise.all([birinci, ikinci]);
    expect(sayac).toBe(1);
  });

  it('ikinci çağrı sürenin bitişini bekler', async () => {
    const yurutuc = new TekYurutuc();
    const kapi = ertelenmis();
    let ikinciBitti = false;

    const birinci = yurutuc.yurut(() => kapi.promise);
    const ikinci = yurutuc.yurut(() => kapi.promise).then(() => {
      ikinciBitti = true;
    });

    await Promise.resolve();
    expect(ikinciBitti).toBe(false);

    kapi.coz();
    await Promise.all([birinci, ikinci]);
    expect(ikinciBitti).toBe(true);
  });

  it('süren bittikten sonra gelen çağrı işi yeniden çalıştırır', async () => {
    const yurutuc = new TekYurutuc();
    let sayac = 0;
    const is = async () => {
      sayac++;
    };

    await yurutuc.yurut(is);
    await yurutuc.yurut(is);
    expect(sayac).toBe(2);
  });

  it('iş fırlatırsa iki çağrı da hatayı görür, sonraki çağrı yeniden çalıştırır', async () => {
    const yurutuc = new TekYurutuc();
    const kapi = ertelenmis();
    let sayac = 0;
    const is = () => {
      sayac++;
      return kapi.promise;
    };

    const birinci = yurutuc.yurut(is);
    const ikinci = yurutuc.yurut(is);
    kapi.reddet(new Error('patladı'));

    await expect(birinci).rejects.toThrow('patladı');
    await expect(ikinci).rejects.toThrow('patladı');

    await yurutuc.yurut(async () => {
      sayac++;
    });
    expect(sayac).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run tests/tekYurutuc.test.ts`
Expected: FAIL — `Failed to resolve import "../src/is/tekYurutuc.js"`

- [ ] **Step 3: Write minimal implementation**

`src/is/tekYurutuc.ts`:

```ts
/**
 * Aynı işi N işçiden yalnızca birine yaptırır; süren varken gelenler ona katılır.
 *
 * Paralel üretimde üç yerde gerekiyor. Bu koruma olmadan 3 işçi: 3 ayrı 15 dk
 * rate-limit uykusuna girip 45 dk'ya serileşir, 3 ayrı "giriş yapın" kartı
 * çıkarır, tarayıcıyı 3 kez yeniden başlatır.
 */
export class TekYurutuc {
  private suren: Promise<void> | null = null;

  yurut(is: () => Promise<void>): Promise<void> {
    if (this.suren !== null) return this.suren;

    // `finally` ile temizlik: süren iş bittikten sonra sorun HÂLÂ duruyorsa
    // bir sonraki işçinin kendi tespiti yeni bir yürütme başlatabilmeli.
    this.suren = is().finally(() => {
      this.suren = null;
    });
    return this.suren;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run tests/tekYurutuc.test.ts`
Expected: PASS (4 test)

- [ ] **Step 5: Tüm ağacı doğrula**

Run: `yarn test && yarn typecheck`
Expected: hepsi PASS

- [ ] **Step 6: Commit**

```bash
git add src/is/tekYurutuc.ts tests/tekYurutuc.test.ts
git commit -m "feat: TekYurutuc — aynı işi N işçiden yalnızca birine yaptırır"
```

---

### Task 2: `esZamanliSekme` proje ayarı

**Files:**
- Modify: `src/depo/projeler.ts` (`Ayarlar`, `VARSAYILAN_AYARLAR`, `ayarlariDogrula`, `projedenConfig`, yeni `sekmeSayisiDogrula`)
- Modify: `src/tipler.ts` (`Config`)
- Modify: `tests/worker.test.ts` (`CONFIG` sabitine yeni alan — yoksa tip hatası)
- Test: `tests/projeler.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `Ayarlar.esZamanliSekme: number` ve `Config.esZamanliSekme: number`
  (1-4 tam sayı, varsayılan 1). Task 7 `baslat.ts` içinde `config.esZamanliSekme`
  okur; Task 8 `web/js/editor.js` içinde `ayarlar.esZamanliSekme` yazar.

- [ ] **Step 1: Write the failing test**

`tests/projeler.test.ts` dosyasının sonuna, mevcut `describe` bloklarının
yanına ekle:

```ts
describe('esZamanliSekme ayarı', () => {
  const temel = { id: 'p1', ad: 'Proje', ciktiKlasoru: '/tmp/cikti-p1' };

  it('alan yoksa 1 döner (eski proje dosyaları için göç yolu)', () => {
    const proje = projeDogrula({ ...temel, ayarlar: {} }, '/tmp/kok');
    expect(proje.ayarlar.esZamanliSekme).toBe(1);
  });

  it('geçerli değeri korur', () => {
    const proje = projeDogrula({ ...temel, ayarlar: { esZamanliSekme: 3 } }, '/tmp/kok');
    expect(proje.ayarlar.esZamanliSekme).toBe(3);
  });

  it('aralık dışını ve tam sayı olmayanı reddeder', () => {
    for (const gecersiz of [0, 5, 2.5, -1, '3']) {
      expect(() =>
        projeDogrula({ ...temel, ayarlar: { esZamanliSekme: gecersiz } }, '/tmp/kok'),
      ).toThrow('esZamanliSekme 1 ile 4 arasında tam sayı olmalı');
    }
  });

  it('projedenConfig alanı Config\'e taşır', () => {
    const proje = projeDogrula({ ...temel, ayarlar: { esZamanliSekme: 2 } }, '/tmp/kok');
    expect(projedenConfig(proje, '/tmp/profil').esZamanliSekme).toBe(2);
  });
});
```

Dosyanın en üstündeki import satırında `projeDogrula` ve `projedenConfig`
yoksa ekle:

```ts
import { projeDogrula, projedenConfig } from '../src/depo/projeler.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run tests/projeler.test.ts`
Expected: FAIL — `expected undefined to be 1`

- [ ] **Step 3: Write minimal implementation**

`src/depo/projeler.ts`:

1. `Ayarlar` arayüzüne alan ekle (`rateLimitVarsayilanBeklemeDk`'nın altına):

```ts
  /** Eş zamanlı sekme sayısı, 1-4. 1 = bugünkü sıralı davranış. */
  esZamanliSekme: number;
```

2. `VARSAYILAN_AYARLAR`'a ekle:

```ts
  esZamanliSekme: 1,
```

3. `ayarlariDogrula`'nın döndürdüğü nesneye ekle:

```ts
    esZamanliSekme: sekmeSayisiDogrula(kaynak.esZamanliSekme),
```

4. `ayarlariDogrula`'nın üstündeki yorumda `5 alanını` → `6 alanını` yap.

5. `satirArasiBeklemeDogrula`'nın hemen altına yeni fonksiyon:

```ts
/**
 * Üst sınır 4: ChatGPT görsel kotası hesap başına olduğu için daha fazla sekme
 * hız kazandırmaz, yalnızca otomasyon imzasını büyütür.
 */
function sekmeSayisiDogrula(ham: unknown): number {
  if (ham === undefined) return VARSAYILAN_AYARLAR.esZamanliSekme;

  if (typeof ham !== 'number' || !Number.isInteger(ham) || ham < 1 || ham > 4) {
    throw new Error('esZamanliSekme 1 ile 4 arasında tam sayı olmalı');
  }
  return ham;
}
```

6. `projedenConfig`'in döndürdüğü nesneye ekle:

```ts
    esZamanliSekme: proje.ayarlar.esZamanliSekme,
```

`src/tipler.ts` — `Config` arayüzüne ekle:

```ts
  /** Eş zamanlı sekme sayısı, 1-4. 1 = sıralı. */
  esZamanliSekme: number;
```

`tests/worker.test.ts` — `CONFIG` sabitine ekle (aksi halde tip hatası):

```ts
  esZamanliSekme: 1,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run tests/projeler.test.ts && yarn typecheck`
Expected: PASS

- [ ] **Step 5: Tüm ağacı doğrula**

Run: `yarn test && yarn typecheck`
Expected: hepsi PASS. `tests/isYoneticisi.test.ts` içinde de bir `Config`
sabiti varsa oraya da `esZamanliSekme: 1` eklenmesi gerekir — typecheck bunu
söyleyecektir.

- [ ] **Step 6: Commit**

```bash
git add src/depo/projeler.ts src/tipler.ts tests/projeler.test.ts tests/worker.test.ts tests/isYoneticisi.test.ts
git commit -m "feat: esZamanliSekme proje ayarı (1-4, varsayılan 1)"
```

---

### Task 3: Sekme arayüzü — saf refactor, davranış değişmez

Bu task **tek bir davranış bile değiştirmez**. Amacı: `UretimTarayicisi`'ni
context ve sekme diye ikiye ayırmak, `worker.ts`'i tek sekme yerine sekme
*dizisi* alacak hale getirmek. Sonunda mevcut testlerin **tamamı** aynen
geçmeli — bu, sonraki tasklarda paralelliği güvenle ekleyebilmenin kilidi.

**Files:**
- Modify: `src/tipler.ts` (`UretimTarayicisi` bölünür, `UretimSekmesi` doğar)
- Modify: `src/tarayici.ts` (`ChatgptTarayicisi` + yeni `ChatgptSekmesi`)
- Modify: `src/worker.ts` (`WorkerBagimliliklari`, `satiriIsle` imzası)
- Modify: `src/is/isYoneticisi.ts` (`IsAyarlari`)
- Modify: `src/baslat.ts` (`isBaslat`)
- Test: `tests/worker.test.ts`, `tests/isYoneticisi.test.ts` (sahte tarayıcı → sahte sekmeler)

**Interfaces:**
- Consumes: —
- Produces:
  - `UretimSekmesi` — `yeniSohbetAc()`, `oturumAcikMi()`, `aktifModelAdi()`,
    `gorselUret(prompt, zamanAsimiSn)`, `sonGorseliKaydet(hedefYol)`
  - `UretimTarayicisi` — `baslat()`, `yenidenBaslat()`,
    `sekmeleriHazirla(n: number): Promise<UretimSekmesi[]>`, `kapat()`
  - `WorkerBagimliliklari.sekmeler: UretimSekmesi[]`
  - `WorkerBagimliliklari.tarayiciYenidenBaslat: () => Promise<void>`
  - `IsAyarlari.sekmeler` ve `IsAyarlari.tarayiciYenidenBaslat` (aynı tipler)

- [ ] **Step 1: Testleri yeni arayüze taşı (henüz kırmızı olacak)**

`tests/worker.test.ts` — `sahteTarayici` fonksiyonunu **tamamen** şununla
değiştir (import satırındaki `UretimTarayicisi` → `UretimSekmesi`):

```ts
function sahteSekmeler(secenekler: SahteSecenekler = {}, adet = 1) {
  // Diziler sekmeler arasında PAYLAŞILIR: testler sonuç sırasını kurgulayarak
  // hangi sekmenin ne alacağını belirleyebilsin.
  const sonuclar = [...(secenekler.sonuclar ?? [])];
  const oturumlar = [...(secenekler.oturum ?? [])];
  const cagrilar: string[] = [];
  const yenidenBaslat = async () => {
    cagrilar.push('yenidenBaslat');
  };

  const sekmeler: UretimSekmesi[] = Array.from({ length: adet }, () => ({
    yeniSohbetAc: async () => {
      cagrilar.push('yeniSohbet');
    },
    oturumAcikMi: async () => (oturumlar.length > 0 ? oturumlar.shift()! : true),
    aktifModelAdi: async () => secenekler.model ?? 'GPT-5',
    gorselUret: async () => {
      cagrilar.push('uret');
      return sonuclar.shift() ?? { tip: 'gorsel' };
    },
    sonGorseliKaydet: async (yol: string) => {
      cagrilar.push(`kaydet:${yol}`);
    },
  }));

  return { sekmeler, cagrilar, yenidenBaslat };
}
```

`bagimliliklar` imzasını ve gövdesini güncelle:

```ts
function bagimliliklar(
  sekmeler: UretimSekmesi[],
  tarayiciYenidenBaslat: () => Promise<void>,
  ek: Partial<WorkerBagimliliklari> = {},
): WorkerBagimliliklari & { /* … mevcut ek alanlar aynen … */ } {
  // … mevcut gövde …
  return {
    config: CONFIG,
    sekmeler,
    tarayiciYenidenBaslat,
    logger: { bilgi: vi.fn(), uyari: vi.fn(), hata: vi.fn() } as never,
    // … kalan alanlar aynen …
  };
}
```

Her testte çağrı biçimini çevir. Örnek (ilk test):

```ts
const { sekmeler, cagrilar, yenidenBaslat } = sahteSekmeler({ sonuclar: [{ tip: 'gorsel' }] });
const b = bagimliliklar(sekmeler, yenidenBaslat);
```

Sekme metodunu ezen üç testi de çevir:

- `'yanlış model seçiliyse kullanıcıyı bekler'` →
  `(sekmeler[0] as { aktifModelAdi: () => Promise<string> }).aktifModelAdi = async () => 'GPT-5';`
- `'tarayıcı hatasında yeniden başlatır ve tekrar dener'` →
  `const orijinalYeniSohbet = sekmeler[0].yeniSohbetAc;` ve
  `sekmeler[0].yeniSohbetAc = async () => { … }`
- `'oturum düşünce kullanıcıyı bekler'` → değişiklik gerekmez (seçenekle çalışıyor)

`tests/isYoneticisi.test.ts` — `sahteTarayici(sonuclar)` fonksiyonunu
`sahteSekme(sonuclar): UretimSekmesi` yap (tek sekme döndürür, context
metotları yok). `ayarlar({ tarayici })` çağrılarını
`ayarlar({ sekmeler: [sekme], tarayiciYenidenBaslat })` yap;
`tarayici.oturumAcikMi = …` / `tarayici.yeniSohbetAc = …` ezmeleri
`sekme.…` olur. `tarayici.yenidenBaslat = …` ezmesi artık ayrı bir
`tarayiciYenidenBaslat` casusudur:

```ts
let yenidenBaslatSayisi = 0;
const tarayiciYenidenBaslat = async () => {
  yenidenBaslatSayisi++;
};
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run tests/worker.test.ts`
Expected: FAIL — `Object literal may only specify known properties, 'sekmeler' does not exist in type 'WorkerBagimliliklari'` (veya çalışma anında `Cannot read properties of undefined`)

- [ ] **Step 3: `src/tipler.ts` — arayüzü ikiye ayır**

`UretimTarayicisi` bloğunu şununla değiştir:

```ts
/** Chromium context'i — bütün sekmeler paylaşır. */
export interface UretimTarayicisi {
  baslat(): Promise<void>;
  yenidenBaslat(): Promise<void>;
  /** Sekme sayısını n'e tamamlar ve hepsinin tutamacını döndürür. */
  sekmeleriHazirla(n: number): Promise<UretimSekmesi[]>;
  kapat(): Promise<void>;
}

/** Tek sekme — tek bir işçiye aittir, paylaşılmaz. */
export interface UretimSekmesi {
  yeniSohbetAc(): Promise<void>;
  oturumAcikMi(): Promise<boolean>;
  aktifModelAdi(): Promise<string>;
  gorselUret(prompt: string, zamanAsimiSn: number): Promise<GorselSonucu>;
  sonGorseliKaydet(hedefYol: string): Promise<void>;
}
```

- [ ] **Step 4: `src/tarayici.ts` — sınıfı ikiye ayır**

`ChatgptTarayicisi`'nı şununla değiştir (`RED_KALIPLARI` ve importlar aynen
kalır; import satırına `UretimSekmesi` eklenir):

```ts
export class ChatgptTarayicisi implements UretimTarayicisi {
  private context: BrowserContext | null = null;
  private sayfalar: Page[] = [];
  /** yenidenBaslat() aynı sayıda sekmeyi geri kurabilsin diye saklanır. */
  private sekmeSayisi = 1;

  constructor(private profilYolu: string) {}

  async baslat(): Promise<void> {
    this.context = await chromium.launchPersistentContext(this.profilYolu, {
      headless: false,
      viewport: null,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    const ilk = this.context.pages()[0] ?? (await this.context.newPage());
    await ilk.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded' });
    this.sayfalar = [ilk];
    // Çökme sonrası kurtarmada eski sekme sayısı geri kurulur; ilk açılışta
    // sekmeSayisi 1 olduğu için bu çağrı bir şey yapmaz.
    await this.sayfalariTamamla(this.sekmeSayisi);
  }

  async yenidenBaslat(): Promise<void> {
    await this.kapat().catch(() => {});
    await this.baslat();
  }

  async sekmeleriHazirla(n: number): Promise<UretimSekmesi[]> {
    this.sekmeSayisi = n;
    await this.sayfalariTamamla(n);
    return Array.from({ length: n }, (_, slot) => new ChatgptSekmesi(this, slot));
  }

  async kapat(): Promise<void> {
    await this.context?.close();
    this.context = null;
    this.sayfalar = [];
  }

  /**
   * `ChatgptSekmesi` için: slot'un GÜNCEL sayfası.
   * Yeniden başlatma diziyi tazelediği için sekme tutamaçları geçerli kalır.
   */
  sayfaAl(slot: number): Page {
    const sayfa = this.sayfalar[slot];
    if (!sayfa) {
      throw new Error(`sekme ${slot} hazır değil; önce sekmeleriHazirla() çağrılmalı`);
    }
    return sayfa;
  }

  private async sayfalariTamamla(n: number): Promise<void> {
    const context = this.context;
    if (!context) throw new Error('tarayıcı başlatılmadı; önce baslat() çağrılmalı');

    while (this.sayfalar.length < n) {
      const sayfa = await context.newPage();
      await sayfa.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded' });
      this.sayfalar.push(sayfa);
    }
  }
}

/**
 * Tek sekme tutamacı. Ham `Page` TUTMAZ: `yenidenBaslat()` bütün `Page`
 * nesnelerini öldürüyor; slot dolaylaması sayesinde işçinin elindeki tutamaç
 * çökme sonrasında da geçerli kalır.
 */
export class ChatgptSekmesi implements UretimSekmesi {
  constructor(
    private ana: ChatgptTarayicisi,
    private slot: number,
  ) {}

  private sayfa(): Page {
    return this.ana.sayfaAl(this.slot);
  }

  // Aşağıdaki beş metodun ve sonSohbetTuruMetni'nin GÖVDELERİ eski
  // ChatgptTarayicisi'ndekiyle birebir aynıdır; buraya taşınırlar:
  //   yeniSohbetAc, oturumAcikMi, aktifModelAdi, gorselUret,
  //   sonGorseliKaydet, private sonSohbetTuruMetni
}
```

Eski `private sayfa()` metodu silinir (yerini `sayfaAl` + `ChatgptSekmesi.sayfa`
alır). Beş genel metot ile `sonSohbetTuruMetni` **kesip yapıştırılır**, gövde
içi hiçbir satır değişmez.

- [ ] **Step 5: `src/worker.ts` — sekme dizisi al, hâlâ sıralı işle**

`WorkerBagimliliklari`'nda:

```ts
export interface WorkerBagimliliklari {
  config: Config;
  sekmeler: UretimSekmesi[];
  tarayiciYenidenBaslat: () => Promise<void>;
  logger: Logger;
  // … kalan alanlar aynen …
}
```

`import type` satırında `UretimTarayicisi` → `UretimSekmesi`.

`tumSatirlariIsle` içinde tek değişiklik:

```ts
    const sonuc = await satiriIsle(b, b.sekmeler[0], satir);
```

`satiriIsle` imzası ve gövdesindeki üç isim:

```ts
async function satiriIsle(
  b: WorkerBagimliliklari,
  sekme: UretimSekmesi,
  satir: Satir,
): Promise<SatirSonucu> {
```

Gövdede: `b.tarayici.yeniSohbetAc()` → `sekme.yeniSohbetAc()`,
`b.tarayici.oturumAcikMi()` → `sekme.oturumAcikMi()`,
`b.tarayici.aktifModelAdi()` → `sekme.aktifModelAdi()`,
`b.tarayici.gorselUret(...)` → `sekme.gorselUret(...)`,
`b.tarayici.sonGorseliKaydet(...)` → `sekme.sonGorseliKaydet(...)`,
`b.tarayici.yenidenBaslat()` → `b.tarayiciYenidenBaslat()`.
Başka hiçbir satır değişmez.

- [ ] **Step 6: `src/is/isYoneticisi.ts` — ayarları geçir**

`IsAyarlari`'nda `tarayici: UretimTarayicisi;` satırını şununla değiştir:

```ts
  sekmeler: UretimSekmesi[];
  tarayiciYenidenBaslat: () => Promise<void>;
```

`import type` satırında `UretimTarayicisi` → `UretimSekmesi`.

`baslat()` içindeki worker bağımlılık nesnesinde `tarayici: ayarlar.tarayici,`
satırını şununla değiştir:

```ts
          sekmeler: ayarlar.sekmeler,
          tarayiciYenidenBaslat: ayarlar.tarayiciYenidenBaslat,
```

- [ ] **Step 7: `src/baslat.ts` — tek sekme hazırla**

`isBaslat` içindeki `await tarayiciAc(); if (!tarayici) throw …` bloğunu
şununla değiştir (kapanış içinde `tarayici` daralması kaybolduğu için yerel
sabit şart):

```ts
        await tarayiciAc();
        const acikTarayici = tarayici;
        if (!acikTarayici) throw new Error('tarayıcı açılamadı');

        const sekmeler = await acikTarayici.sekmeleriHazirla(1);

        const ozet = await isYoneticisi.baslat({
          projeId: proje.id,
          config: projedenConfig(proje, profil),
          satirlar: proje.satirlar,
          sekmeler,
          tarayiciYenidenBaslat: () => acikTarayici.yenidenBaslat(),
          logger,
          // … kalan alanlar aynen …
        });
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `yarn test && yarn typecheck`
Expected: hepsi PASS. **Hiçbir test iddiası değişmedi** — yalnızca kurulum
kodu çevrildi. Bir iddia düşüyorsa refactor davranış değiştirmiştir, geri dön.

- [ ] **Step 9: Commit**

```bash
git add src/tipler.ts src/tarayici.ts src/worker.ts src/is/isYoneticisi.ts src/baslat.ts tests/worker.test.ts tests/isYoneticisi.test.ts
git commit -m "refactor: tarayıcı context ve sekme olarak ikiye ayrıldı"
```

---

### Task 4: İşçi havuzu + kademeli başlangıç

**Files:**
- Modify: `src/worker.ts` (`tumSatirlariIsle`, yeni `birIsciCalistir`, `UykuSebebi`)
- Test: `tests/worker.test.ts`

**Interfaces:**
- Consumes: `WorkerBagimliliklari.sekmeler` (Task 3)
- Produces: `UykuSebebi` artık `'satirArasi' | 'rateLimit' | 'geciciHata' | 'baslangic'`
  — Task 6 `IsYoneticisi.uyuVeYayinla` bu birleşimi kapsar.

- [ ] **Step 1: Write the failing tests**

`tests/worker.test.ts` içindeki `describe('tumSatirlariIsle', …)` bloğunun
sonuna ekle:

```ts
  it('N=3 iken 7 satırın her birini tam bir kez işler', async () => {
    const { sekmeler, cagrilar, yenidenBaslat } = sahteSekmeler({}, 3);
    const b = bagimliliklar(sekmeler, yenidenBaslat);
    const satirlar: Satir[] = Array.from({ length: 7 }, (_, i) => ({
      metin: `varyasyon ${i}`,
      dosyaAdi: `dosya_${i}`,
    }));

    const ozet = await tumSatirlariIsle(b, satirlar);

    expect(ozet).toEqual({ basarili: 7, atlanan: 0, basarisiz: 0 });
    expect(cagrilar.filter((c) => c === 'uret')).toHaveLength(7);
    const kaydedilen = cagrilar.filter((c) => c.startsWith('kaydet:'));
    expect(new Set(kaydedilen).size).toBe(7);
  });

  it('N=3 iken her satır için tam bir başladı ve bir bitti olayı yayınlar', async () => {
    const { sekmeler, yenidenBaslat } = sahteSekmeler({}, 3);
    const b = bagimliliklar(sekmeler, yenidenBaslat);
    const satirlar: Satir[] = Array.from({ length: 6 }, (_, i) => ({
      metin: `varyasyon ${i}`,
      dosyaAdi: `dosya_${i}`,
    }));

    await tumSatirlariIsle(b, satirlar);

    for (let sira = 1; sira <= 6; sira++) {
      expect(b.olaylar.filter((o) => o.startsWith(`basladi:${sira}:`))).toHaveLength(1);
      expect(b.olaylar.filter((o) => o.startsWith(`bitti:${sira}:`))).toHaveLength(1);
    }
  });

  it('satır sayısı sekme sayısından azsa fazla işçi boşta çıkar', async () => {
    const { sekmeler, cagrilar, yenidenBaslat } = sahteSekmeler({}, 4);
    const b = bagimliliklar(sekmeler, yenidenBaslat);

    const ozet = await tumSatirlariIsle(b, [SATIR]);

    expect(ozet.basarili).toBe(1);
    expect(cagrilar.filter((c) => c === 'uret')).toHaveLength(1);
  });

  it('işçi i, ilk satırından önce i × satırArası kadar baslangic uykusu yapar', async () => {
    // min = maks: rastgeleSureMs deterministik olsun
    const { sekmeler, yenidenBaslat } = sahteSekmeler({}, 3);
    const b = bagimliliklar(sekmeler, yenidenBaslat, {
      config: { ...CONFIG, satirArasiBekleme: [10, 10] },
    });

    await tumSatirlariIsle(b, [SATIR, { metin: 'plajda', dosyaAdi: 'plaj' }, { metin: 'dağda', dosyaAdi: 'dag' }]);

    const kaymalar = b.beklemeler.filter((x) => x.sebep === 'baslangic').map((x) => x.ms);
    // İşçi 0 hiç kaymaz (0 ms uyku yapılmaz), işçi 1 ve 2 kayar
    expect(kaymalar.sort((a, c) => a - c)).toEqual([10_000, 20_000]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run tests/worker.test.ts`
Expected: FAIL — `expected 1 to have length 7` (tek işçi çalıştığı için `uret`
7 kez çağrılıyor ama sıralı; asıl düşen `baslangic` testi:
`expected [] to equal [ 10000, 20000 ]`)

- [ ] **Step 3: Write the implementation**

`src/worker.ts`:

1. `UykuSebebi`'yi genişlet:

```ts
export type UykuSebebi = 'satirArasi' | 'rateLimit' | 'geciciHata' | 'baslangic';
```

2. `tumSatirlariIsle`'yi tamamen şununla değiştir:

```ts
export async function tumSatirlariIsle(b: WorkerBagimliliklari, satirlar: Satir[]): Promise<IslemOzeti> {
  const ozet: IslemOzeti = { basarili: 0, atlanan: 0, basarisiz: 0 };
  let imlec = 0;

  // Okuma ile artırma arasında `await` YOK — Node tek iş parçacıklı olduğu için
  // bu atomiktir; iki işçi asla aynı satırı çekemez.
  const siradaki = (): { sira: number; satir: Satir } | null =>
    imlec < satirlar.length ? { sira: ++imlec, satir: satirlar[imlec - 1] } : null;

  await Promise.all(
    b.sekmeler.map((sekme, sira) => birIsciCalistir(b, sekme, sira, siradaki, ozet, satirlar.length)),
  );

  return ozet;
}

/**
 * Tek bir sekmede kuyruk boşalana kadar satır işler.
 *
 * `isciSirasi` yalnızca kademeli başlangıç için: N prompt aynı milisaniyede
 * uçarsa hem otomasyon imzası büyür hem de hesap zaten limitliyse N işçi
 * limiti aynı anda keşfedip N deneme hakkını birden yakar.
 */
async function birIsciCalistir(
  b: WorkerBagimliliklari,
  sekme: UretimSekmesi,
  isciSirasi: number,
  siradaki: () => { sira: number; satir: Satir } | null,
  ozet: IslemOzeti,
  toplam: number,
): Promise<void> {
  if (isciSirasi > 0) {
    await b.uyu(isciSirasi * rastgeleSureMs(b.config.satirArasiBekleme), 'baslangic');
  }

  for (;;) {
    if (b.kontrol.signal.aborted) return;
    await b.kontrol.kapi.gec();
    if (b.kontrol.signal.aborted) return;

    const is = siradaki();
    if (is === null) return; // kuyruk boşaldı, işçi kendini çeker

    const { sira, satir } = is;

    if (b.tamamlandiMi(satir.dosyaAdi)) {
      b.logger.bilgi(`[${sira}/${toplam}] atlandı (zaten var): ${satir.dosyaAdi}.png`);
      ozet.atlanan++;
      b.satirBitti(sira, 'atlandi');
      continue;
    }

    b.logger.bilgi(`[${sira}/${toplam}] işleniyor: ${satir.dosyaAdi}`);
    b.satirBasladi(sira, toplam, satir);

    const sonuc = await satiriIsle(b, sekme, satir);
    if (sonuc.basarili) {
      ozet.basarili++;
      b.satirBitti(sira, 'basarili');
    } else {
      ozet.basarisiz++;
      b.satirBitti(sira, 'basarisiz', sonuc.sebep);
    }

    await b.uyu(rastgeleSureMs(b.config.satirArasiBekleme), 'satirArasi');
  }
}
```

`UretimSekmesi` zaten import edilmiş durumda (Task 3).

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run tests/worker.test.ts`
Expected: PASS — hem yeni paralel testler hem de N=1 ile çalışan **tüm mevcut
testler**.

- [ ] **Step 5: Tüm ağacı doğrula**

Run: `yarn test && yarn typecheck`
Expected: hepsi PASS

- [ ] **Step 6: Commit**

```bash
git add src/worker.ts tests/worker.test.ts
git commit -m "feat: paylaşılan kuyruk üstünde N işçi, kademeli başlangıç"
```

---

### Task 5: Koordinasyon kapıları — worker tarafı

**Files:**
- Modify: `src/is/kapi.ts` (yeni `IsKapilari` arayüzü)
- Modify: `src/worker.ts` (`WorkerBagimliliklari.kapilar`, `kapilariGec`)
- Test: `tests/worker.test.ts`

**Interfaces:**
- Consumes: `Kapi` (mevcut)
- Produces: `export interface IsKapilari { limit: Kapi; kullanici: Kapi; yenidenBaslatma: Kapi }`
  ve `WorkerBagimliliklari.kapilar: IsKapilari` — Task 6 bunları `IsYoneticisi`'nden
  besler.

- [ ] **Step 1: Write the failing test**

`tests/worker.test.ts` — import satırına `IsKapilari` ekle:

```ts
import { Kapi, type IsKapilari } from '../src/is/kapi.js';
```

`bagimliliklar` fonksiyonunda döndürülen nesneye ekle (mevcut `kontrol`
satırının hemen altına):

```ts
    kapilar: { limit: new Kapi(), kullanici: new Kapi(), yenidenBaslatma: new Kapi() },
```

`describe` bloğunun sonuna üç test ekle:

```ts
  it('limit kapısı kapalıyken yeni satır çekmez, açılınca sürer', async () => {
    const { sekmeler, cagrilar, yenidenBaslat } = sahteSekmeler({}, 1);
    const kapilar: IsKapilari = {
      limit: new Kapi(),
      kullanici: new Kapi(),
      yenidenBaslatma: new Kapi(),
    };
    const b = bagimliliklar(sekmeler, yenidenBaslat, { kapilar });
    kapilar.limit.kapat();

    let bitti = false;
    const calisma = tumSatirlariIsle(b, [SATIR]).then(() => {
      bitti = true;
    });

    await Promise.resolve();
    expect(cagrilar).not.toContain('uret');
    expect(bitti).toBe(false);

    kapilar.limit.ac();
    await calisma;
    expect(cagrilar).toContain('uret');
  });

  it('kullanıcı kapısı kapalıyken yeni satır çekmez', async () => {
    const { sekmeler, cagrilar, yenidenBaslat } = sahteSekmeler({}, 1);
    const kapilar: IsKapilari = {
      limit: new Kapi(),
      kullanici: new Kapi(),
      yenidenBaslatma: new Kapi(),
    };
    const b = bagimliliklar(sekmeler, yenidenBaslat, { kapilar });
    kapilar.kullanici.kapat();

    const calisma = tumSatirlariIsle(b, [SATIR]);
    await Promise.resolve();
    expect(cagrilar).not.toContain('uret');

    kapilar.kullanici.ac();
    await calisma;
    expect(cagrilar).toContain('uret');
  });

  it('yeniden başlatma kapısı kapalıyken yeni satır çekmez', async () => {
    const { sekmeler, cagrilar, yenidenBaslat } = sahteSekmeler({}, 1);
    const kapilar: IsKapilari = {
      limit: new Kapi(),
      kullanici: new Kapi(),
      yenidenBaslatma: new Kapi(),
    };
    const b = bagimliliklar(sekmeler, yenidenBaslat, { kapilar });
    kapilar.yenidenBaslatma.kapat();

    const calisma = tumSatirlariIsle(b, [SATIR]);
    await Promise.resolve();
    expect(cagrilar).not.toContain('uret');

    kapilar.yenidenBaslatma.ac();
    await calisma;
    expect(cagrilar).toContain('uret');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run tests/worker.test.ts`
Expected: FAIL — `Failed to resolve import` yok ama tip hatası:
`'IsKapilari' is not exported`; çalışma anında `expected [ 'yeniSohbet', 'uret' ] not to contain 'uret'`

- [ ] **Step 3: Write the implementation**

`src/is/kapi.ts` — dosyanın sonuna ekle:

```ts
/**
 * Worker'ın döngü başında geçtiği koordinasyon kapıları.
 *
 * Üçü de "ilk gören yapar, diğerleri bekler" ilkesinin kapı yarısıdır: bir işçi
 * sorunu ele alırken diğerleri UÇUŞTAKİ işini bitirir ama YENİ satır çekemez.
 * Diğer yarı `TekYurutuc` (bkz. src/is/tekYurutuc.ts).
 */
export interface IsKapilari {
  limit: Kapi;
  kullanici: Kapi;
  yenidenBaslatma: Kapi;
}
```

`src/worker.ts`:

1. Import satırını güncelle:

```ts
import type { IsKapilari, Kapi } from './is/kapi.js';
```

(`Kapi` zaten `IsKontrolu` içinde kullanılıyor.)

2. `WorkerBagimliliklari`'na alan ekle (`kontrol`'ün hemen altına):

```ts
  kapilar: IsKapilari;
```

3. `birIsciCalistir`'ın üstüne yardımcı ekle:

```ts
/** Duraklatma + üç koordinasyon kapısı. Hepsi tek yerde geçilir. */
async function kapilariGec(b: WorkerBagimliliklari): Promise<void> {
  await b.kontrol.kapi.gec();
  await b.kapilar.limit.gec();
  await b.kapilar.kullanici.gec();
  await b.kapilar.yenidenBaslatma.gec();
}
```

4. `birIsciCalistir` döngü başındaki `await b.kontrol.kapi.gec();` satırını
   şununla değiştir:

```ts
    await kapilariGec(b);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run tests/worker.test.ts`
Expected: PASS. Mevcut `'duraklatılmışken satır başlatmaz'` testi de geçmeli
— `kapilariGec` duraklatma kapısını hâlâ ilk sırada geçiyor.

- [ ] **Step 5: Tüm ağacı doğrula**

Run: `yarn test && yarn typecheck`
Expected: FAIL beklenir — `tests/isYoneticisi.test.ts` `kapilar` alanını
göndermiyor. `IsYoneticisi` bunu Task 6'da besleyecek; şimdilik
`isYoneticisi.ts`'de worker bağımlılık nesnesine geçici olarak ekle:

```ts
          kapilar: { limit: new Kapi(), kullanici: new Kapi(), yenidenBaslatma: new Kapi() },
```

Sonra tekrar `yarn test && yarn typecheck` — hepsi PASS.

- [ ] **Step 6: Commit**

```bash
git add src/is/kapi.ts src/worker.ts src/is/isYoneticisi.ts tests/worker.test.ts
git commit -m "feat: worker döngüsü üç koordinasyon kapısından geçiyor"
```

---

### Task 6: `IsYoneticisi` koordinasyonu — üç `Kapi` + `TekYurutuc` çifti

**Files:**
- Modify: `src/is/isYoneticisi.ts`
- Test: `tests/isYoneticisi.test.ts`

**Interfaces:**
- Consumes: `TekYurutuc` (Task 1), `IsKapilari` (Task 5),
  `IsAyarlari.tarayiciYenidenBaslat` (Task 3)
- Produces: davranış; yeni genel API yok.

- [ ] **Step 1: Write the failing tests**

`tests/isYoneticisi.test.ts` sonuna yeni bir `describe` ekle. `ayarlar(...)`
yardımcısının mevcut imzasını kullan; `sekmeler` alanına birden fazla sahte
sekme ver.

```ts
describe('paralel koordinasyon', () => {
  it('iki sekme aynı anda rate limit görürse yalnızca bir uyku yapılır', async () => {
    const uykular: number[] = [];
    const y = new IsYoneticisi();
    const sekmeler = [
      sahteSekme([{ tip: 'rateLimit', mesaj: 'Try again in 2 minutes.' }, { tip: 'gorsel' }]),
      sahteSekme([{ tip: 'rateLimit', mesaj: 'Try again in 2 minutes.' }, { tip: 'gorsel' }]),
    ];

    await y.baslat(
      ayarlar({
        satirlar: [SATIRLAR[0], SATIRLAR[1]],
        sekmeler,
        uyuMotoru: async (ms) => {
          uykular.push(ms);
        },
      }),
    );

    // İki sekme de limit gördü ama TekYurutuc tek uykuya bağladı
    expect(uykular.filter((ms) => ms === 2 * 60_000)).toHaveLength(1);
  });

  it('iki sekme aynı anda oturum kapalı görürse tek kullaniciGerekli olayı çıkar', async () => {
    const y = new IsYoneticisi();
    let oturumAcik = false;
    const sekme = () => {
      const s = sahteSekme();
      s.oturumAcikMi = async () => oturumAcik;
      return s;
    };

    const olaylar: string[] = [];
    y.dinle((olay) => {
      olaylar.push(olay.tip);
      if (olay.tip === 'kullaniciGerekli') {
        oturumAcik = true;
        setTimeout(() => y.kullaniciHazir(), 0);
      }
    });

    await y.baslat(ayarlar({ satirlar: [SATIRLAR[0], SATIRLAR[1]], sekmeler: [sekme(), sekme()] }));

    expect(olaylar.filter((t) => t === 'kullaniciGerekli')).toHaveLength(1);
  });

  it('iki sekme aynı anda çökerse tarayıcı bir kez yeniden başlatılır', async () => {
    const y = new IsYoneticisi();
    let yenidenBaslatSayisi = 0;
    const ilkCagri = new Map<number, boolean>();

    const sekmeler = [0, 1].map((no) => {
      const s = sahteSekme();
      ilkCagri.set(no, true);
      s.yeniSohbetAc = async () => {
        if (ilkCagri.get(no)) {
          ilkCagri.set(no, false);
          throw new Error('tarayıcı çöktü');
        }
      };
      return s;
    });

    await y.baslat(
      ayarlar({
        satirlar: [SATIRLAR[0], SATIRLAR[1]],
        sekmeler,
        tarayiciYenidenBaslat: async () => {
          yenidenBaslatSayisi++;
        },
      }),
    );

    expect(yenidenBaslatSayisi).toBe(1);
  });
});
```

> **Not:** Üçüncü test iki sekmenin çökmesinin *aynı ana denk gelmesine*
> dayanıyor. Kademeli başlangıç (Task 4) işçi 1'i geciktirdiği için testte
> `satirArasiBekleme: [0, 0]` olmalı — `ayarlar()` yardımcısındaki `CONFIG`
> zaten `[0, 0]` kullanıyor, doğrula. Eğer `yenidenBaslatSayisi` 2 çıkıyorsa
> iki çökme farklı zamanlara düşmüştür; testi `uyuMotoru: async () => {}`
> vererek (tüm uykuları anlık yaparak) sıkılaştır.

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run tests/isYoneticisi.test.ts`
Expected: FAIL — `expected [ 120000, 120000 ] to have length 1`,
`expected 2 to be 1`

- [ ] **Step 3: Write the implementation**

`src/is/isYoneticisi.ts`:

1. Import ekle:

```ts
import { Kapi, type IsKapilari } from './kapi.js';
import { TekYurutuc } from './tekYurutuc.js';
```

2. Sınıf alanlarına ekle (`private kapi = new Kapi();` satırının altına):

```ts
  /**
   * Üç koordinasyon çifti. `Kapi` "iş sürerken kimse yeni satır çekmesin",
   * `TekYurutuc` "işi yalnızca bir işçi yapsın" der. Bu sarmalama burada
   * durduğu için `worker.ts` tarafında koordinasyona dair hiç kod yok.
   */
  private kapilar: IsKapilari = {
    limit: new Kapi(),
    kullanici: new Kapi(),
    yenidenBaslatma: new Kapi(),
  };
  private limitYurutuc = new TekYurutuc();
  private kullaniciYurutuc = new TekYurutuc();
  private yenidenBaslatmaYurutuc = new TekYurutuc();
```

3. `baslat()` başındaki sıfırlama bloğuna (`this.kapi = new Kapi();`
   satırından sonra) ekle:

```ts
    this.kapilar = { limit: new Kapi(), kullanici: new Kapi(), yenidenBaslatma: new Kapi() };
    this.limitYurutuc = new TekYurutuc();
    this.kullaniciYurutuc = new TekYurutuc();
    this.yenidenBaslatmaYurutuc = new TekYurutuc();
```

4. Worker bağımlılık nesnesinde Task 5'te geçici olarak eklenen `kapilar`
   satırını kalıcı hale getir ve yeniden başlatmayı sar:

```ts
          kapilar: this.kapilar,
          tarayiciYenidenBaslat: () => this.yenidenBaslat(ayarlar.tarayiciYenidenBaslat),
```

5. `uyuVeYayinla`'yı tamamen şununla değiştir:

```ts
  private async uyuVeYayinla(
    motor: (ms: number, secenekler: UykuSecenekleri) => Promise<void>,
    ms: number,
    sebep: UykuSebebi,
  ): Promise<void> {
    if (sebep === 'geciciHata') this.yayinla({ tip: 'geciciHata' });

    if (sebep !== 'rateLimit') {
      await motor(ms, { signal: this.kontrolcu.signal, kapi: this.kapi });
      return;
    }

    // N işçiden yalnızca biri uyur, diğerleri AYNI uykuya katılır; aksi halde
    // 3 işçi × 15 dk 45 dk'ya serileşirdi. Kapı ise, uyku sürerken uçuştaki
    // işini bitiren işçinin YENİ satır çekmesini engeller.
    await this.limitYurutuc.yurut(async () => {
      this.kapilar.limit.kapat();
      this.durumDegistir('limitBekliyor');
      try {
        await motor(ms, {
          signal: this.kontrolcu.signal,
          kapi: this.kapi,
          tik: (kalanMs) => this.yayinla({ tip: 'limitBekleniyor', kalanSn: Math.round(kalanMs / 1000) }),
        });
      } finally {
        this.kapilar.limit.ac();
      }

      if (this.durumu === 'limitBekliyor' && !this.kontrolcu.signal.aborted) {
        this.durumDegistir('calisiyor');
      }
    });
  }
```

6. Mevcut `kullaniciyiBekle` metodunun **adını** `tekKullaniciBeklemesi`
   yap (gövdesi ve içindeki yorumlar aynen kalır), üstüne yeni sarmalayıcı
   ekle:

```ts
  private kullaniciyiBekle(mesaj: string): Promise<void> {
    if (this.kontrolcu.signal.aborted) return Promise.resolve();

    // İlk gören kartı çıkarır; diğer işçiler AYNI beklemeye katılır — N ayrı
    // "giriş yapın" kartı çıkmaz. Kullanıcı bir kez onaylayınca hepsi çözülür.
    return this.kullaniciYurutuc.yurut(async () => {
      this.kapilar.kullanici.kapat();
      try {
        await this.tekKullaniciBeklemesi(mesaj);
      } finally {
        this.kapilar.kullanici.ac();
      }
    });
  }
```

7. Sınıfa yeni özel metot ekle:

```ts
  /**
   * Tarayıcı çökmesinde: yalnızca ilk işçi gerçekten yeniden başlatır, sonraki
   * çağrılar aynı işleme katılır. Kapı, döngü başında bekleyen işçilerin
   * yeniden başlatma sürerken satır çekip boşuna deneme hakkı yakmasını önler.
   */
  private yenidenBaslat(hamYenidenBaslat: () => Promise<void>): Promise<void> {
    return this.yenidenBaslatmaYurutuc.yurut(async () => {
      this.kapilar.yenidenBaslatma.kapat();
      try {
        await hamYenidenBaslat();
      } finally {
        this.kapilar.yenidenBaslatma.ac();
      }
    });
  }
```

8. `durdur()` içinde bekleyenlerin çözülmesi için üç kapıyı da aç
   (`this.kapi.ac();` satırının altına):

```ts
    this.kapilar.limit.ac();
    this.kapilar.kullanici.ac();
    this.kapilar.yenidenBaslatma.ac();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run tests/isYoneticisi.test.ts`
Expected: PASS — yeni üç test ve mevcut 15+ testin tamamı.

- [ ] **Step 5: Tüm ağacı doğrula**

Run: `yarn test && yarn typecheck`
Expected: hepsi PASS

- [ ] **Step 6: Commit**

```bash
git add src/is/isYoneticisi.ts tests/isYoneticisi.test.ts
git commit -m "feat: rate limit, kullanıcı ve yeniden başlatma tek işçi tarafından ele alınıyor"
```

---

### Task 7: `biten` + `ucusta` ilerleme bilgisi, N sekme bağlantısı

Bu task bir de **mevcut hatayı** düzeltiyor: `satirBitti` olayı `ozet`
taşımadığı için arayüzdeki `✓ / atlanan / ✗` sayaçları koşu boyunca donuyor;
yalnızca durum değişimlerinde tazeleniyor.

**Files:**
- Modify: `src/is/olaylar.ts` (`satirBitti` olayına `dosyaAdi` + `ozet`)
- Modify: `src/is/isYoneticisi.ts` (`IsBilgisi.biten`, `IsBilgisi.ucusta`, olay yayını)
- Modify: `src/baslat.ts` (`sekmeleriHazirla(n)`)
- Test: `tests/isYoneticisi.test.ts`, `tests/sunucu-is.test.ts`

**Interfaces:**
- Consumes: `Config.esZamanliSekme` (Task 2)
- Produces:
  - `IsOlayi` içinde `{ tip: 'satirBitti'; sira: number; dosyaAdi: string; sonuc: …; ozet: IslemOzeti; sebep?: string }`
  - `IsBilgisi` içinde `biten: number; ucusta: string[]`
  — Task 8 arayüzü bunlardan besler.

- [ ] **Step 1: Write the failing tests**

`tests/isYoneticisi.test.ts` — yeni testler:

```ts
  it('bilgi() biten sayısını ve uçuştaki dosyaları taşır', async () => {
    const y = new IsYoneticisi();
    const ucustaGoruntuler: string[][] = [];
    y.dinle((olay) => {
      if (olay.tip === 'satirBasladi') ucustaGoruntuler.push(y.bilgi().ucusta);
    });

    await y.baslat(ayarlar({ satirlar: [SATIRLAR[0], SATIRLAR[1]] }));

    // Satır başlarken o dosya uçuşta görünmeli
    expect(ucustaGoruntuler[0]).toContain(SATIRLAR[0].dosyaAdi);
    // İş bitince kuyruk da uçuş listesi de boşalmalı
    expect(y.bilgi().ucusta).toEqual([]);
    expect(y.bilgi().biten).toBe(2);
  });

  it('satirBitti olayı dosyaAdi ve güncel özeti taşır', async () => {
    const y = new IsYoneticisi();
    const bitenler: Array<{ dosyaAdi: string; basarili: number }> = [];
    y.dinle((olay) => {
      if (olay.tip === 'satirBitti') {
        bitenler.push({ dosyaAdi: olay.dosyaAdi, basarili: olay.ozet.basarili });
      }
    });

    await y.baslat(ayarlar({ satirlar: [SATIRLAR[0]] }));

    expect(bitenler).toEqual([{ dosyaAdi: SATIRLAR[0].dosyaAdi, basarili: 1 }]);
  });
```

`tests/sunucu-is.test.ts` — `GET /api/is` yanıtını sınayan teste ekle (yoksa
yeni test yaz):

```ts
  it('GET /api/is biten ve ucusta alanlarını döndürür', async () => {
    const yanit = await uygulama.inject({ method: 'GET', url: '/api/is', headers: BASLIKLAR });
    expect(yanit.statusCode).toBe(200);
    const govde = yanit.json();
    expect(govde.biten).toBe(0);
    expect(govde.ucusta).toEqual([]);
  });
```

> `BASLIKLAR` ve `uygulama` adlarını dosyanın mevcut kurulum kodundan al —
> `tests/sunucu-is.test.ts` zaten token başlığıyla istek atıyor.

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run tests/isYoneticisi.test.ts tests/sunucu-is.test.ts`
Expected: FAIL — `Property 'ucusta' does not exist on type 'IsBilgisi'`,
`Property 'dosyaAdi' does not exist on type ...`

- [ ] **Step 3: Olayı genişlet**

`src/is/olaylar.ts` — `satirBitti` satırını şununla değiştir:

```ts
  | {
      tip: 'satirBitti';
      sira: number;
      /** UI'ın "üretiliyor" listesinden satırı çıkarabilmesi için. */
      dosyaAdi: string;
      sonuc: 'basarili' | 'atlandi' | 'basarisiz';
      /** Sayaçlar koşu boyunca canlı kalsın diye her satırda güncel özet. */
      ozet: IslemOzeti;
      sebep?: string;
    }
```

- [ ] **Step 4: `IsYoneticisi`'ni güncelle**

`src/is/isYoneticisi.ts`:

1. `IsBilgisi` arayüzüne ekle:

```ts
  /** basarili + atlanan + basarisiz. Paralelde `sira` anlamını yitirdi. */
  biten: number;
  /** Şu an üretimde olan satırların dosya adları. */
  ucusta: string[];
```

2. Sınıf alanı ekle:

```ts
  private ucusta = new Set<string>();
```

3. `baslat()` sıfırlama bloğuna ekle:

```ts
    this.ucusta.clear();
```

4. `bilgi()`'yi güncelle:

```ts
  bilgi(): IsBilgisi {
    const ozet = { ...this.ozet };
    return {
      durum: this.durumu,
      projeId: this.projeId,
      ozet,
      sira: this.sira,
      toplam: this.toplam,
      biten: ozet.basarili + ozet.atlanan + ozet.basarisiz,
      ucusta: [...this.ucusta],
    };
  }
```

5. Worker geri çağrılarını güncelle:

```ts
          satirBasladi: (sira, toplam, satir) => {
            this.sira = sira;
            this.toplam = toplam;
            this.ucusta.add(satir.dosyaAdi);
            this.yayinla({ tip: 'satirBasladi', sira, toplam, dosyaAdi: satir.dosyaAdi });
          },
          satirBitti: (sira, sonuc, sebep) => {
            // Atlanan satırlarda worker satirBasladi'yı çağırmaz; sira burada da
            // güncellenmeli, yoksa iş bittiğinde bilgi() sira:0 gösterir.
            this.sira = sira;
            if (sonuc === 'basarili') this.ozet.basarili++;
            else if (sonuc === 'atlandi') this.ozet.atlanan++;
            else this.ozet.basarisiz++;

            const satir = ayarlar.satirlar[sira - 1];
            const dosyaAdi = satir?.dosyaAdi ?? '';
            this.ucusta.delete(dosyaAdi);

            if (sonuc === 'basarili' && satir) {
              this.yayinla({ tip: 'gorselHazir', dosyaAdi });
            }
            this.yayinla({ tip: 'satirBitti', sira, dosyaAdi, sonuc, ozet: { ...this.ozet }, sebep });
          },
```

- [ ] **Step 5: `baslat.ts` — N sekme hazırla**

Task 3'te eklenen `sekmeleriHazirla(1)` satırını şununla değiştir:

```ts
        const config = projedenConfig(proje, profil);
        // Kırpma: 2 satırlık projede 4 sekme açmanın anlamı yok.
        const sekmeSayisi = Math.min(config.esZamanliSekme, Math.max(proje.satirlar.length, 1));
        const sekmeler = await acikTarayici.sekmeleriHazirla(sekmeSayisi);
```

ve aşağıdaki `config: projedenConfig(proje, profil),` satırını `config,` yap.

- [ ] **Step 6: Run tests to verify they pass**

Run: `yarn test && yarn typecheck`
Expected: hepsi PASS. `tests/worker.test.ts`'teki `satirBitti` casusu üç
parametre alıyor (`sira, sonuc, sebep`) — worker imzası değişmediği için
dokunulmaz.

- [ ] **Step 7: Commit**

```bash
git add src/is/olaylar.ts src/is/isYoneticisi.ts src/baslat.ts tests/isYoneticisi.test.ts tests/sunucu-is.test.ts
git commit -m "feat: biten/ucusta ilerleme bilgisi, satirBitti olayı özet taşıyor"
```

---

### Task 8: Arayüz, README ve canlı doğrulama

**Files:**
- Modify: `web/js/durum.js` (`is.biten`, `is.ucusta`)
- Modify: `web/js/akis.js` (`satirBasladi` / `satirBitti` işleme)
- Modify: `web/js/ilerleme.js` (sayaç + "Üretiliyor" satırı, `isDurumunuTazele`, şerit)
- Modify: `web/js/editor.js` (`AYAR_ALANLARI`, `formdanProje`, `projeyiDogrula`, `ayarlariCiz`)
- Modify: `README.md`

**Interfaces:**
- Consumes: `IsBilgisi.biten`, `IsBilgisi.ucusta`, `satirBitti.dosyaAdi`,
  `satirBitti.ozet` (Task 7); `Ayarlar.esZamanliSekme` (Task 2)
- Produces: —

- [ ] **Step 1: `web/js/durum.js` — state alanları**

`is` nesnesine iki alan ekle (`toplam: 0,` satırının altına):

```js
    biten: 0,
    /** Şu an üretimde olan dosya adları. */
    ucusta: [],
```

- [ ] **Step 2: `web/js/akis.js` — olayları işle**

`satirBasladi` dalını şununla değiştir:

```js
    case 'satirBasladi':
      is.sira = olay.sira;
      is.toplam = olay.toplam;
      is.ucusta = [...is.ucusta, olay.dosyaAdi];
      guncelle({ is });
      kayitEkle(`${olay.sira}/${olay.toplam} ${olay.dosyaAdi} başladı`);
      return;
```

`satirBitti` dalını şununla değiştir:

```js
    case 'satirBitti':
      is.ozet = olay.ozet;
      is.biten = olay.ozet.basarili + olay.ozet.atlanan + olay.ozet.basarisiz;
      is.ucusta = is.ucusta.filter((ad) => ad !== olay.dosyaAdi);
      guncelle({ is });
      kayitEkle(`${olay.sira}. satır: ${olay.sonuc}${olay.sebep ? ` (${olay.sebep})` : ''}`);
      return;
```

`durum` dalında `is.ozet = olay.ozet;` satırının altına ekle:

```js
      is.biten = olay.ozet.basarili + olay.ozet.atlanan + olay.ozet.basarisiz;
```

`bitti` dalında `is.ozet = olay.ozet;` satırının altına ekle:

```js
      is.biten = olay.ozet.basarili + olay.ozet.atlanan + olay.ozet.basarisiz;
      is.ucusta = [];
```

- [ ] **Step 3: `web/js/ilerleme.js` — sayaç ve "Üretiliyor" satırı**

`isDurumunuTazele` içindeki `guncelle` çağrısına iki alan ekle:

```js
        sira: bilgi.sira,
        toplam: bilgi.toplam,
        biten: bilgi.biten,
        ucusta: bilgi.ucusta,
```

`ilerlemeyiCiz` içindeki sayaç satırını şununla değiştir:

```js
    const sayac = document.createElement('p');
    sayac.className = 'soluk';
    sayac.textContent =
      `${is.biten}/${is.toplam} · ✓ ${is.ozet.basarili} · atlanan ${is.ozet.atlanan} · ✗ ${is.ozet.basarisiz}`;
    kap.append(sayac);

    // Paralelde tek bir "şu anki satır" yok; uçuştakilerin hepsi yazılır.
    if (is.ucusta.length > 0) {
      const ucusta = document.createElement('p');
      ucusta.className = 'soluk';
      ucusta.textContent = `Üretiliyor: ${is.ucusta.join(' · ')}`;
      kap.append(ucusta);
    }
```

`seridiCiz` içindeki metin satırını şununla değiştir:

```js
  metin.textContent =
    `▶ ${ozet ? ozet.ad : durum.is.projeId} — ${durum.is.biten}/${durum.is.toplam}`;
```

- [ ] **Step 4: `web/js/editor.js` — ayar alanı**

1. `AYAR_ALANLARI` dizisine yeni girdi ekle (dizinin sonuna):

```js
  { anahtar: 'esZamanliSekme', etiket: 'Eş zamanlı sekme', tur: 'number', maks: 4,
    ipucu: '1 = sırayla. Yükseltmek üretimi hızlandırır, ama ChatGPT kotası hesap başınadır — limit daha erken gelebilir.' },
```

2. `formdanProje`'deki `ayarlar` nesnesine ekle:

```js
      esZamanliSekme: Number($('ayar-esZamanliSekme').value),
```

3. `projeyiDogrula`'ya, pozitif sayı döngüsünden **sonra** ekle:

```js
  const sekme = proje.ayarlar.esZamanliSekme;
  if (!Number.isInteger(sekme) || sekme < 1 || sekme > 4) {
    return 'Eş zamanlı sekme 1 ile 4 arasında tam sayı olmalı';
  }
```

4. `ayarlariCiz` içindeki ızgara döngüsünde, `girdi.min = '1';` satırının
   altına ekle:

```js
    if (alan.maks !== undefined) girdi.max = String(alan.maks);
```

- [ ] **Step 5: `README.md` — ayar tablosu ve paralellik bölümü**

"### Ayarlar" tablosuna satır ekle (`Limit varsayılan bekleme`'nin altına):

```markdown
| `Eş zamanlı sekme` | Aynı anda kaç sekmede üretim yapılacağı (1-4). `1` sırayla üretir. Ayrıntı için aşağıdaki "Paralel üretim" bölümü. |
```

"## Devam (Resume)" bölümünün **öncesine** yeni bölüm ekle:

```markdown
## Paralel üretim

Varsayılan olarak satırlar tek sekmede sırayla üretilir. **Eş zamanlı sekme**
ayarını 2-4 yaparsanız aynı Chromium penceresinde o kadar sekme açılır ve
satırlar aralarında paylaştırılır. Bir görsel ~60 saniye sürdüğü için 3 sekme
200 satırlık bir koşuyu ~3,5 saatten ~1,2 saate indirebilir.

"Edebilir", çünkü kazanç darboğaza bağlı:

- Darboğaz **üretim gecikmesi** ise kazanç N katına yakındır.
- Darboğaz **ChatGPT'nin görsel kotası** ise kazanç yoktur: kota hesap
  başınadır, N sekme onu N kat hızlı tüketip beklemeye geçer.

Hangisi olduğunu ancak deneyerek görürsünüz. Bu yüzden varsayılan `1`: önce
2'de deneyin, `calisma.log`'da limit uyarısı çıkmıyorsa 3'e çıkın.

Rate limit geldiğinde **bütün sekmeler** durur: limiti ilk gören sekme bekler,
diğerleri elindeki görseli bitirip yeni satır çekmeyi keser. Aynı şekilde
oturum düşerse tek bir "Giriş yaptım, devam et" kartı çıkar ve onayınız tüm
sekmeleri birden serbest bırakır.

Sekmeler kademeli açılır (her sekme bir öncekinden "satır arası bekleme" kadar
sonra başlar); N prompt aynı anda gitmez.
```

"## Sorun Giderme" bölümüne madde ekle:

```markdown
**Paralelde limit sürekli geliyor:** Eş zamanlı sekmeyi düşürün. `1` bugünkü
sıralı davranışa döner ve her zaman güvenli seçenektir.
```

- [ ] **Step 6: Tüm ağacı doğrula**

Run: `yarn test && yarn typecheck`
Expected: hepsi PASS (web/ tipsiz olduğu için typecheck'e girmez).

- [ ] **Step 7: Elle canlı doğrulama**

`web/` altında birim test yok; bu adım zorunlu.

1. `yarn baslat` — terminaldeki adresi aç.
2. Yeni proje aç, base prompt'a `{VARYASYON}` koy, **4 satır** gir.
3. Ayarlardan **Eş zamanlı sekme = 2** yap; gösterge "Kaydedildi" demeli.
4. `1 · Tarayıcıyı aç` → ChatGPT'ye giriş yap → `2 · Başlat`.
5. Doğrula:
   - Chromium'da **2 sekme** açılıyor, ikincisi biraz gecikmeli başlıyor.
   - Sağ kolonda "Üretiliyor:" satırı **iki dosya adı** gösteriyor.
   - Sayaç `biten/toplam` olarak ilerliyor ve `✓` sayısı **koşu sırasında**
     artıyor (donuk kalmıyor).
   - Üst şeride bakmak için başka projeye geçince şerit `biten/toplam`
     gösteriyor.
   - İş bitince Chromium kapanıyor, 4 PNG diskte.
6. Ayarı **3** yapıp tekrar çalıştır; `~/.chatgpt-gorsel-uretici/calisma.log`
   dosyasında `rate limit algılandı` satırı çıkıyor mu kaydet — bu, spec §1'de
   bilinmeyen kota duvarının ilk ölçümüdür.
7. Ayarı **1** yapıp bir kez daha çalıştır; tek sekme açıldığını ve davranışın
   eskisiyle aynı olduğunu doğrula.

- [ ] **Step 8: Commit**

```bash
git add web/js/durum.js web/js/akis.js web/js/ilerleme.js web/js/editor.js README.md
git commit -m "feat: paralel üretim arayüzü — eş zamanlı sekme ayarı ve uçuşta listesi"
```

---

## Self-Review Notları

Plan yazıldıktan sonra spec'e karşı kontrol edildi:

**Spec kapsaması.** §3.1 → Task 3. §3.2 → Task 4. §3.3 → Task 1 + 5 + 6.
§4 → Task 2 + Task 7 Step 5. §5 → Task 8. §6 → her task'ın test adımları +
Task 8 Step 7. §7 riskleri tasarım kararlarına gömülü, ayrı task istemiyor.

**Spec'te olmayan, planda eklenen bir düzeltme.** Task 7, `satirBitti`
olayına `ozet` ekliyor. Bu spec'te yoktu; plan yazılırken `web/js/akis.js`
okunurken bulundu: olay `ozet` taşımadığı için arayüzdeki `✓ / atlanan / ✗`
sayaçları yalnızca durum değişimlerinde tazeleniyor, koşu boyunca donuk
kalıyor. Yeni `biten` sayacı da aynı kaynaktan besleneceği için düzeltme
zorunlu hale geldi. Spec §5'teki olay tablosuna bu satır eklenmelidir.

**Tip tutarlılığı.** `UretimSekmesi` (Task 3) → `WorkerBagimliliklari.sekmeler`
(Task 3) → `sahteSekmeler` (Task 3-4) aynı ad. `IsKapilari` (Task 5) → üç
alanı (`limit`, `kullanici`, `yenidenBaslatma`) Task 6'da birebir aynı adlarla
kullanılıyor. `esZamanliSekme` (Task 2) → `config.esZamanliSekme` (Task 7) →
`ayar-esZamanliSekme` DOM id (Task 8) tutarlı. `IsBilgisi.biten` / `ucusta`
(Task 7) → `durum.is.biten` / `durum.is.ucusta` (Task 8) tutarlı.
