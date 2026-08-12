# Çok Proje + UI Kabuğu (Faz 2B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tek projeli aracı çok projeli hale getirmek: diskte proje başına JSON, solda proje listesi, projeye girince kendi base promptu / satır listesi / parametreleri / galerisi.

**Architecture:** Kalıcılık `src/depo/projeler.ts` içindeki yeni `ProjelerDepo` sınıfına taşınır (proje başına dosya, atomik yazma, göç, silme). Sunucu tekil `/api/proje` rotalarını `/api/projeler/:id` ile değiştirir; token artık cookie ile de taşınır ki modüllere bölünmüş UI 401 yemesin. UI `web/` altında native ES modüllerine bölünür — build adımı yok. `IsYoneticisi` ve `worker.ts` hiç değişmez.

**Tech Stack:** TypeScript (ESM, `.js` uzantılı importlar), Fastify 5, vitest, Node 20+. Frontend bağımlılığı yok.

**Spec:** `docs/superpowers/specs/2026-08-11-cok-proje-ui-design.md`

## Global Constraints

- Tüm tanımlayıcılar Türkçe. Tek istisna: `signal` (`AbortController.signal` platform API adı).
- Import'lar `.js` uzantılı: `import { slugla } from './kimlik.js'`.
- **Playwright'a dokunan tek modül `src/tarayici.ts`'dir.** `src/sunucu/` ve `src/depo/` altındaki hiçbir dosya `playwright` import etmez.
- Sunucu **yalnızca `127.0.0.1`'e** bağlanır, asla `0.0.0.0`'a.
- Dosya servis eden her rota, yolun izinli kök içinde kaldığını `path.resolve` ile doğrular (`icerdeMi`), gerçek dosya erişiminde symlink çözer (`gercekYolIcerdeMi`).
- Kabuk komutu string olarak çalıştırılmaz; `execFile` + argüman dizisi kullanılır.
- URL'den gelen `:id` **asla** doğrudan dosya yoluna girmez; önce `idGecerliMi()` süzgecinden geçer.
- Yeni npm bağımlılığı eklenmez. Cookie ayrıştırma elle yapılır.
- `IsYoneticisi`, `worker.ts`, `tarayici.ts`, `prompt.ts`, `rateLimit.ts`, `bekleme.ts`, `logger.ts`, `durum.ts` **değiştirilmez**.
- SSE olay tipleri (`src/is/olaylar.ts`) **değiştirilmez**.
- Her task sonunda `yarn test` ve `yarn typecheck` temiz geçmeli.
- **Commit atma:** kullanıcı açıkça istemedikçe hiçbir git komutu çalıştırılmaz (`git commit`/`add`/`rm` yasak). Dosya silme gerekiyorsa düz `rm`.

## Dosya Yapısı

**Yeni:**

| Dosya | Sorumluluk |
|---|---|
| `src/depo/kimlik.ts` | Slug üretimi, id üretimi, id doğrulama (saf fonksiyonlar) |
| `src/depo/gorselSil.ts` | Klasördeki PNG'leri güvenlik kısıtlarıyla silme |
| `src/depo/projeler.ts` | `Proje` tipleri, doğrulama, `ProjelerDepo` (CRUD + göç + silme) |
| `web/css/stil.css` | Tüm CSS (bugün `index.html` içinde inline) |
| `web/js/api.js` | `fetch` sarmalı + rota çağrıları |
| `web/js/durum.js` | İstemci durumu + `abone()` pub-sub |
| `web/js/projeler.js` | Sol panel: liste, yeni, sil, seç |
| `web/js/editor.js` | Base prompt + önizleme + ayarlar + otomatik kaydetme |
| `web/js/liste.js` | Satır tablosu + CSV modu |
| `web/js/galeri.js` | Galeri ızgarası + klasörü aç |
| `web/js/ilerleme.js` | İlerleme kartı + iş butonları + üst şerit |
| `web/js/akis.js` | SSE → durum |
| `web/js/uygulama.js` | Wiring + `#/proje/<id>` yönlendirmesi |

**Değişen:** `src/depo/yollar.ts`, `src/sunucu/index.ts`, `src/baslat.ts`, `web/index.html`

**Silinen:** `src/depo/projeDepo.ts`, `tests/projeDepo.test.ts`, `tests/sunucu-proje.test.ts` (yerine `tests/sunucu-projeler.test.ts`)

**Değişen testler:** `tests/sunucu-galeri.test.ts`, `tests/sunucu-bos-govde.test.ts`, `tests/sunucu-yetki-yan-etki.test.ts`, `tests/sunucu-is.test.ts`, `tests/sunucu-tarayici.test.ts`

---

### Task 1: Kimlik — slug ve id üretimi

**Files:**
- Create: `src/depo/kimlik.ts`
- Create: `tests/kimlik.test.ts`
- Modify: `src/depo/yollar.ts` (satır 8-10: `projeYolu` yerine üç yeni fonksiyon)

**Interfaces:**
- Consumes: yok
- Produces:
  - `slugla(ad: string): string`
  - `idUret(ad: string, varMi: (id: string) => boolean, hexUret?: () => string): string`
  - `idGecerliMi(id: string): boolean`
  - `projelerKlasoru(veriKoku: string): string`
  - `projeDosyaYolu(veriKoku: string, id: string): string`
  - `eskiProjeYolu(veriKoku: string): string`

- [ ] **Step 1: Testleri yaz**

`tests/kimlik.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { idGecerliMi, idUret, slugla } from '../src/depo/kimlik.js';

describe('slugla', () => {
  it('boşlukları tire yapar ve küçültür', () => {
    expect(slugla('Kedi Serisi')).toBe('kedi-serisi');
  });

  it('Türkçe karakterleri ASCII karşılığına çevirir', () => {
    expect(slugla('Şeker Böcüğü İĞÜ')).toBe('seker-bocugu-igu');
  });

  it('noktalama ve tekrarlayan ayırıcıları tek tireye indirir', () => {
    expect(slugla('Ürün  çekimi!!! (v2)')).toBe('urun-cekimi-v2');
  });

  it('baştaki ve sondaki tireleri atar', () => {
    expect(slugla('  --deneme--  ')).toBe('deneme');
  });

  it('slug boş kalırsa "proje" döner', () => {
    expect(slugla('***')).toBe('proje');
    expect(slugla('   ')).toBe('proje');
  });

  it('40 karakteri aşmaz ve sonda tire bırakmaz', () => {
    const slug = slugla('a'.repeat(38) + ' bcdef');
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('idUret', () => {
  it('slug + hex biçiminde id üretir', () => {
    expect(idUret('Kedi Serisi', () => false, () => '9f2a')).toBe('kedi-serisi-9f2a');
  });

  it('id zaten varsa yeni hex dener', () => {
    const hexler = ['aaaa', 'bbbb'];
    const id = idUret('Kedi', (aday) => aday === 'kedi-aaaa', () => hexler.shift() as string);
    expect(id).toBe('kedi-bbbb');
  });

  it('50 denemede benzersiz id bulunamazsa hata verir', () => {
    expect(() => idUret('Kedi', () => true, () => 'aaaa')).toThrow(/benzersiz id/);
  });
});

describe('idGecerliMi', () => {
  it('küçük harf, rakam ve tire kabul eder', () => {
    expect(idGecerliMi('kedi-serisi-9f2a')).toBe(true);
  });

  it('yol ayırıcısı ve nokta içeren id\'yi reddeder', () => {
    // Bu, :id parametresinin dosya yoluna girdiği yerdeki path traversal savunması
    expect(idGecerliMi('../gizli')).toBe(false);
    expect(idGecerliMi('a/b')).toBe(false);
    expect(idGecerliMi('a.b')).toBe(false);
    expect(idGecerliMi('')).toBe(false);
    expect(idGecerliMi('BÜYÜK')).toBe(false);
  });
});
```

- [ ] **Step 2: Testin başarısız olduğunu gör**

Run: `yarn vitest run tests/kimlik.test.ts`
Expected: FAIL — `Cannot find module '../src/depo/kimlik.js'`

- [ ] **Step 3: `src/depo/kimlik.ts` dosyasını yaz**

```ts
import { randomBytes } from 'node:crypto';

/** Türkçe harfler `toLowerCase` sonrası da ASCII'ye çevrilmeli. */
const TURKCE_HARFLER: Record<string, string> = {
  ç: 'c', ğ: 'g', ı: 'i', i̇: 'i', ö: 'o', ş: 's', ü: 'u',
};

const ID_KALIBI = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Proje adını dosya adı ve klasör adı olarak kullanılabilir hale getirir.
 * Boş sonuç "proje" olur — adı tamamen noktalamadan oluşan bir proje
 * yoksa dosya adı `.json` olurdu.
 */
export function slugla(ad: string): string {
  const kucuk = ad.toLowerCase();
  const asciiye = [...kucuk].map((harf) => TURKCE_HARFLER[harf] ?? harf).join('');

  const slug = asciiye
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');

  return slug === '' ? 'proje' : slug;
}

/**
 * `<slug>-<4 hex>` biçiminde id üretir. Aynı adlı iki proje çakışmasın diye
 * hex eki var; `varMi` ile çakışma kontrol edilir.
 *
 * @param hexUret Test enjeksiyonu için. Varsayılan: rastgele 2 bayt.
 */
export function idUret(
  ad: string,
  varMi: (id: string) => boolean,
  hexUret: () => string = () => randomBytes(2).toString('hex'),
): string {
  const taban = slugla(ad);
  for (let deneme = 0; deneme < 50; deneme++) {
    const aday = `${taban}-${hexUret()}`;
    if (!varMi(aday)) return aday;
  }
  throw new Error(`"${ad}" için benzersiz id üretilemedi`);
}

/**
 * `:id` URL parametresi dosya yoluna girdiği için zorunlu süzgeç:
 * nokta, eğik çizgi ve büyük harf kabul edilmez, `..` bu yüzden geçemez.
 */
export function idGecerliMi(id: string): boolean {
  return ID_KALIBI.test(id);
}
```

- [ ] **Step 4: Testin geçtiğini gör**

Run: `yarn vitest run tests/kimlik.test.ts`
Expected: PASS (15 test)

- [ ] **Step 5: `src/depo/yollar.ts` içindeki `projeYolu`'nu değiştir**

`src/depo/yollar.ts:8-10` şu bloğu:

```ts
export function projeYolu(veriKoku: string): string {
  return join(veriKoku, 'proje.json');
}
```

şununla değiştir:

```ts
export function projelerKlasoru(veriKoku: string): string {
  return join(veriKoku, 'projeler');
}

export function projeDosyaYolu(veriKoku: string, id: string): string {
  return join(projelerKlasoru(veriKoku), `${id}.json`);
}

/** Faz 2A'nın tekil proje dosyası — yalnızca göç kontrolü için. */
export function eskiProjeYolu(veriKoku: string): string {
  return join(veriKoku, 'proje.json');
}
```

- [ ] **Step 6: `projeYolu`'nun tek kullanıcısını geçici olarak ayakta tut**

`src/depo/projeDepo.ts` bu fonksiyonu import ediyor (satır 6) ve `oku`/`yaz` içinde kullanıyor. Bu dosya Task 4'te silinecek; şimdilik derlenmeye devam etmesi için importu ve iki kullanımı `eskiProjeYolu` ile değiştir:

```ts
import { eskiProjeYolu } from './yollar.js';
```

`oku()` içinde `const yol = projeYolu(this.veriKoku);` → `const yol = eskiProjeYolu(this.veriKoku);`
`yaz()` içinde `atomikYaz(projeYolu(this.veriKoku), ...)` → `atomikYaz(eskiProjeYolu(this.veriKoku), ...)`

- [ ] **Step 7: Tüm testleri ve typecheck'i koştur**

Run: `yarn test && yarn typecheck`
Expected: 180 + 15 = 195 test PASS, typecheck temiz

---

### Task 2: Görsel silme — güvenlik kısıtları

**Files:**
- Create: `src/depo/gorselSil.ts`
- Create: `tests/gorselSil.test.ts`

**Interfaces:**
- Consumes: `icerdeMi` (`src/depo/yollar.ts`)
- Produces:
  - `interface SilmeIslemleri { dosyaSil: (yol: string) => void; klasorSil: (yol: string) => void }`
  - `interface GorselSilmeSonucu { silinen: number; silinemeyen: string[]; korumaliKlasor: boolean }`
  - `klasorGorselleriniSil(klasor: string, korumaliKokler: string[], islemler?: SilmeIslemleri): GorselSilmeSonucu`

- [ ] **Step 1: Testleri yaz**

`tests/gorselSil.test.ts`:

```ts
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
```

- [ ] **Step 2: Testin başarısız olduğunu gör**

Run: `yarn vitest run tests/gorselSil.test.ts`
Expected: FAIL — `Cannot find module '../src/depo/gorselSil.js'`

- [ ] **Step 3: `src/depo/gorselSil.ts` dosyasını yaz**

```ts
import { existsSync, readdirSync, rmSync, rmdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { icerdeMi } from './yollar.js';

/** Silme işlemleri (test enjeksiyonu için). */
export interface SilmeIslemleri {
  dosyaSil: (yol: string) => void;
  klasorSil: (yol: string) => void;
}

export interface GorselSilmeSonucu {
  silinen: number;
  silinemeyen: string[];
  korumaliKlasor: boolean;
}

const varsayilanIslemler: SilmeIslemleri = {
  dosyaSil: (yol) => rmSync(yol),
  klasorSil: (yol) => rmdirSync(yol),
};

/**
 * Bir projenin çıktı klasöründeki görselleri siler.
 *
 * Kısıtlar bilinçli olarak dar: yanlış yapılandırılmış bir `ciktiKlasoru`
 * (ör. ev dizini) felakete dönmemeli.
 * - Yalnızca klasörün doğrudan içindeki `.png` dosyaları silinir
 * - Alt klasörlere inilmez, başka uzantıya dokunulmaz
 * - Symlink'in kendisi silinir; `rmSync` bağı izlemediği için hedef korunur
 * - Klasör `korumaliKokler`den biriyse hiçbir şey silinmez
 * - PNG'ler gittikten sonra klasör boşsa silinir, doluysa bırakılır
 */
export function klasorGorselleriniSil(
  klasor: string,
  korumaliKokler: string[],
  islemler: SilmeIslemleri = varsayilanIslemler,
): GorselSilmeSonucu {
  if (!existsSync(klasor)) {
    return { silinen: 0, silinemeyen: [], korumaliKlasor: false };
  }

  const hedef = resolve(klasor);
  if (korumaliKokler.some((kok) => resolve(kok) === hedef)) {
    return { silinen: 0, silinemeyen: [], korumaliKlasor: true };
  }

  let silinen = 0;
  const silinemeyen: string[] = [];

  for (const giris of readdirSync(hedef, { withFileTypes: true })) {
    if (!giris.isFile() && !giris.isSymbolicLink()) continue;
    if (!giris.name.toLowerCase().endsWith('.png')) continue;

    const yol = join(hedef, giris.name);
    // readdir adları klasörden çıkamaz; yine de savunma katmanı bırakılıyor
    if (!icerdeMi(hedef, yol)) continue;

    try {
      islemler.dosyaSil(yol);
      silinen++;
    } catch {
      silinemeyen.push(giris.name);
    }
  }

  if (readdirSync(hedef).length === 0) {
    try {
      islemler.klasorSil(hedef);
    } catch {
      // klasörü silememek görsellerin silindiği gerçeğini değiştirmez
    }
  }

  return { silinen, silinemeyen, korumaliKlasor: false };
}
```

- [ ] **Step 4: Testin geçtiğini gör**

Run: `yarn vitest run tests/gorselSil.test.ts`
Expected: PASS (9 test)

- [ ] **Step 5: Tüm testleri ve typecheck'i koştur**

Run: `yarn test && yarn typecheck`
Expected: 204 test PASS, typecheck temiz

---

### Task 3: `ProjelerDepo` — çok proje kalıcılığı, göç, silme

Yeni modül olarak yazılır; eski `src/depo/projeDepo.ts` Task 4'te silinecek. Böylece bu task sonunda hem eski hem yeni kod derlenir ve testler yeşil kalır.

**Files:**
- Create: `src/depo/projeler.ts`
- Create: `tests/projeler.test.ts`

**Interfaces:**
- Consumes: `atomikYaz` (`./atomik.js`), `slugla`/`idUret`/`idGecerliMi` (`./kimlik.js`), `projelerKlasoru`/`projeDosyaYolu`/`eskiProjeYolu` (`./yollar.js`), `klasorGorselleriniSil` (`./gorselSil.js`), `dosyaAdiTemizle` (`../liste.js`), `Config`/`Satir` (`../tipler.js`)
- Produces:
  - `interface Ayarlar { modelAdi: string; satirArasiBekleme: [number, number]; uretimZamanAsimiSn: number; tekrarDenemeSayisi: number; rateLimitVarsayilanBeklemeDk: number }`
  - `interface Proje { id: string; ad: string; basePrompt: string; ciktiKlasoru: string; satirlar: Satir[]; ayarlar: Ayarlar; olusturmaTarihi: string; guncellemeTarihi: string }`
  - `interface ProjeOzeti { id: string; ad: string; ciktiKlasoru: string; satirSayisi: number; guncellemeTarihi: string }`
  - `interface ProjeListesi { projeler: ProjeOzeti[]; bozukSayisi: number }`
  - `interface SilmeSonucu { bulundu: boolean; silinen: number; silinemeyen: string[]; korumaliKlasor: boolean }`
  - `const VARSAYILAN_AYARLAR: Ayarlar`
  - `yeniProje(id: string, ad: string, ciktiKoku: string): Proje`
  - `projeDogrula(ham: unknown, ciktiKoku: string): Proje`
  - `projedenConfig(proje: Proje, chromeProfil: string): Config`
  - `class ProjelerDepo` — `constructor(veriKoku: string, ciktiKoku: string)`, `gocEt(): boolean`, `listele(): ProjeListesi`, `oku(id: string): Proje | null`, `olustur(ad: string): Proje`, `yaz(proje: Proje): Proje`, `guncelle(id: string, ham: unknown): Proje`, `sil(id: string, gorselleriSil: boolean): SilmeSonucu`

- [ ] **Step 1: Testleri yaz**

`tests/projeler.test.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
      'modelAdi', 'rateLimitVarsayilanBeklemeDk', 'satirArasiBekleme',
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
    depo.yaz({ ...depo.oku(kedi.id) as never, satirlar: [{ metin: 'a', dosyaAdi: 'a' }] });

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
```

- [ ] **Step 2: Testin başarısız olduğunu gör**

Run: `yarn vitest run tests/projeler.test.ts`
Expected: FAIL — `Cannot find module '../src/depo/projeler.js'`

- [ ] **Step 3: `src/depo/projeler.ts` — tipler ve doğrulama**

Doğrulama mantığı `src/depo/projeDepo.ts`'ten taşınır; `id`, `ad` ve `olusturmaTarihi` alanları eklenir.

```ts
import { existsSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { dosyaAdiTemizle } from '../liste.js';
import type { Config, Satir } from '../tipler.js';
import { atomikYaz } from './atomik.js';
import { klasorGorselleriniSil } from './gorselSil.js';
import { idGecerliMi, idUret, slugla } from './kimlik.js';
import { eskiProjeYolu, projeDosyaYolu, projelerKlasoru } from './yollar.js';

export interface Ayarlar {
  modelAdi: string;
  satirArasiBekleme: [number, number];
  uretimZamanAsimiSn: number;
  tekrarDenemeSayisi: number;
  rateLimitVarsayilanBeklemeDk: number;
}

export interface Proje {
  id: string;
  ad: string;
  basePrompt: string;
  ciktiKlasoru: string;
  satirlar: Satir[];
  ayarlar: Ayarlar;
  olusturmaTarihi: string;
  guncellemeTarihi: string;
}

/** Sol panel için: tam kayıt taşımadan liste çizebilmek. */
export interface ProjeOzeti {
  id: string;
  ad: string;
  ciktiKlasoru: string;
  satirSayisi: number;
  guncellemeTarihi: string;
}

export interface ProjeListesi {
  projeler: ProjeOzeti[];
  /** Okunamayıp .bozuk yapılan dosya sayısı — UI uyarı satırı için. */
  bozukSayisi: number;
}

export interface SilmeSonucu {
  bulundu: boolean;
  silinen: number;
  silinemeyen: string[];
  korumaliKlasor: boolean;
}

export const VARSAYILAN_AYARLAR: Ayarlar = {
  modelAdi: '',
  satirArasiBekleme: [5, 15],
  uretimZamanAsimiSn: 180,
  tekrarDenemeSayisi: 3,
  rateLimitVarsayilanBeklemeDk: 15,
};

export function yeniProje(id: string, ad: string, ciktiKoku: string): Proje {
  return {
    id,
    ad,
    basePrompt: 'Bir kedi, {VARYASYON}, yüksek detaylı',
    ciktiKlasoru: join(ciktiKoku, slugla(ad)),
    satirlar: [],
    ayarlar: { ...VARSAYILAN_AYARLAR },
    olusturmaTarihi: '',
    guncellemeTarihi: '',
  };
}

export function projeDogrula(ham: unknown, ciktiKoku: string): Proje {
  const kaynak = (typeof ham === 'object' && ham !== null ? ham : {}) as Record<string, unknown>;

  const id = typeof kaynak.id === 'string' ? kaynak.id : '';
  if (!idGecerliMi(id)) {
    throw new Error('id geçersiz (yalnızca küçük harf, rakam ve tire)');
  }

  const ad = metinAlan(kaynak.ad, 'Yeni proje');
  const varsayilan = yeniProje(id, ad, ciktiKoku);

  const ciktiKlasoru = metinAlan(kaynak.ciktiKlasoru, varsayilan.ciktiKlasoru).trim();
  if (ciktiKlasoru === '') throw new Error('ciktiKlasoru boş olamaz');

  return {
    id,
    ad,
    basePrompt: metinAlan(kaynak.basePrompt, varsayilan.basePrompt),
    ciktiKlasoru,
    satirlar: satirlariDogrula(kaynak.satirlar),
    ayarlar: ayarlariDogrula(kaynak.ayarlar),
    olusturmaTarihi: metinAlan(kaynak.olusturmaTarihi, ''),
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

/**
 * `Ayarlar`ın 5 alanını tek tek okur, `kaynak`'ı spread ETMEZ. Aksi halde
 * HTTP gövdesinden gelen bilinmeyen alanlar diske birikirdi.
 */
function ayarlariDogrula(ham: unknown): Ayarlar {
  const kaynak = (typeof ham === 'object' && ham !== null ? ham : {}) as Record<string, unknown>;

  const modelAdiHam = kaynak.modelAdi;
  if (modelAdiHam !== undefined && typeof modelAdiHam !== 'string') {
    throw new Error('modelAdi metin olmalı');
  }

  return {
    modelAdi: typeof modelAdiHam === 'string' ? modelAdiHam : VARSAYILAN_AYARLAR.modelAdi,
    satirArasiBekleme: satirArasiBeklemeDogrula(kaynak.satirArasiBekleme),
    uretimZamanAsimiSn: pozitifSayiDogrula(kaynak.uretimZamanAsimiSn, 'uretimZamanAsimiSn'),
    tekrarDenemeSayisi: pozitifSayiDogrula(kaynak.tekrarDenemeSayisi, 'tekrarDenemeSayisi'),
    rateLimitVarsayilanBeklemeDk: pozitifSayiDogrula(
      kaynak.rateLimitVarsayilanBeklemeDk,
      'rateLimitVarsayilanBeklemeDk',
    ),
  };
}

function satirArasiBeklemeDogrula(ham: unknown): [number, number] {
  if (ham === undefined) return VARSAYILAN_AYARLAR.satirArasiBekleme;

  if (
    !Array.isArray(ham) ||
    ham.length !== 2 ||
    ham.some((sn) => typeof sn !== 'number' || !Number.isFinite(sn) || sn < 0) ||
    ham[0] > ham[1]
  ) {
    throw new Error('satirArasiBekleme [min, maks] saniye olmalı (min <= maks)');
  }
  return [ham[0], ham[1]];
}

function pozitifSayiDogrula(
  ham: unknown,
  alan: 'uretimZamanAsimiSn' | 'tekrarDenemeSayisi' | 'rateLimitVarsayilanBeklemeDk',
): number {
  if (ham === undefined) return VARSAYILAN_AYARLAR[alan];

  if (typeof ham !== 'number' || !Number.isFinite(ham) || ham <= 0) {
    throw new Error(`${alan} pozitif bir sayı olmalı`);
  }
  return ham;
}

/** `${yol}.<son>` zaten varsa üzerine yazmaz; ilk boş `-N` adını bulur. */
function benzersizYedekYolu(yol: string, son: string): string {
  const taban = `${yol}.${son}`;
  if (!existsSync(taban)) return taban;

  let sayac = 2;
  while (existsSync(`${taban}-${sayac}`)) sayac++;
  return `${taban}-${sayac}`;
}
```

- [ ] **Step 4: `ProjelerDepo` sınıfını aynı dosyanın sonuna ekle**

```ts
export class ProjelerDepo {
  constructor(
    private veriKoku: string,
    private ciktiKoku: string,
  ) {}

  /**
   * Faz 2A'nın tekil `proje.json`'unu `projeler/<id>.json`'a taşır.
   * Eski dosya `.tasindi` olarak saklanır — silinmez, göç geri dönülebilir.
   * @returns göç yapıldıysa true
   */
  gocEt(): boolean {
    const eski = eskiProjeYolu(this.veriKoku);
    if (!existsSync(eski)) return false;

    let ham: unknown;
    try {
      ham = JSON.parse(readFileSync(eski, 'utf-8'));
    } catch (hata) {
      const bozuk = benzersizYedekYolu(eski, 'bozuk');
      console.error(`eski proje.json ayrıştırılamadı, "${bozuk}" olarak taşınıyor:`, hata);
      renameSync(eski, bozuk);
      return false;
    }

    const kaynak = (typeof ham === 'object' && ham !== null ? ham : {}) as Record<string, unknown>;
    const ad = typeof kaynak.ad === 'string' && kaynak.ad.trim() !== '' ? kaynak.ad : 'Yeni proje';

    try {
      const id = idUret(ad, (aday) => existsSync(projeDosyaYolu(this.veriKoku, aday)));
      this.yaz(projeDogrula({ ...kaynak, id }, this.ciktiKoku));
    } catch (hata) {
      const bozuk = benzersizYedekYolu(eski, 'bozuk');
      console.error(`eski proje.json doğrulanamadı, "${bozuk}" olarak taşınıyor:`, hata);
      renameSync(eski, bozuk);
      return false;
    }

    renameSync(eski, benzersizYedekYolu(eski, 'tasindi'));
    console.log(`proje.json göç etti; eski dosya .tasindi olarak saklandı`);
    return true;
  }

  listele(): ProjeListesi {
    const klasor = projelerKlasoru(this.veriKoku);
    if (!existsSync(klasor)) return { projeler: [], bozukSayisi: 0 };

    const projeler: ProjeOzeti[] = [];
    let bozukSayisi = 0;

    for (const dosya of readdirSync(klasor)) {
      if (!dosya.endsWith('.json')) continue;
      const id = dosya.slice(0, -'.json'.length);
      if (!idGecerliMi(id)) continue;

      const proje = this.oku(id);
      if (proje === null) {
        bozukSayisi++;
        continue;
      }
      projeler.push({
        id: proje.id,
        ad: proje.ad,
        ciktiKlasoru: proje.ciktiKlasoru,
        satirSayisi: proje.satirlar.length,
        guncellemeTarihi: proje.guncellemeTarihi,
      });
    }

    // Alfabetik: otomatik kaydetme "son güncellenen üstte" sıralamasında
    // listeyi yazarken zıplatırdı.
    projeler.sort((a, b) => a.ad.localeCompare(b.ad, 'tr'));
    return { projeler, bozukSayisi };
  }

  /** Yok, geçersiz id veya bozuk dosya → null. Bozuk dosya `.bozuk` yapılır. */
  oku(id: string): Proje | null {
    if (!idGecerliMi(id)) return null;

    const yol = projeDosyaYolu(this.veriKoku, id);
    if (!existsSync(yol)) return null;

    let ham: unknown;
    try {
      ham = JSON.parse(readFileSync(yol, 'utf-8'));
    } catch (hata) {
      return this.bozukYap(yol, 'ayrıştırılamadı', hata);
    }

    try {
      return projeDogrula(ham, this.ciktiKoku);
    } catch (hata) {
      return this.bozukYap(yol, 'doğrulanamadı', hata);
    }
  }

  olustur(ad: string): Proje {
    const temizAd = ad.trim() === '' ? 'Yeni proje' : ad.trim();
    const id = idUret(temizAd, (aday) => existsSync(projeDosyaYolu(this.veriKoku, aday)));

    const taslak = yeniProje(id, temizAd, this.ciktiKoku);
    // Slug klasörü başka projede kullanılıyorsa id'yi klasör adı yap —
    // aksi halde yaz() çakışma hatası verirdi.
    const klasor = this.klasorSahibi(taslak.ciktiKlasoru, id) === null
      ? taslak.ciktiKlasoru
      : join(this.ciktiKoku, id);

    return this.yaz({ ...taslak, ciktiKlasoru: klasor, olusturmaTarihi: new Date().toISOString() });
  }

  yaz(proje: Proje): Proje {
    const dogrulanan = projeDogrula(proje, this.ciktiKoku);

    const sahip = this.klasorSahibi(dogrulanan.ciktiKlasoru, dogrulanan.id);
    if (sahip !== null) {
      throw new Error(`"${sahip}" projesi bu çıktı klasörünü kullanıyor: ${dogrulanan.ciktiKlasoru}`);
    }

    const simdi = new Date().toISOString();
    const damgali: Proje = {
      ...dogrulanan,
      olusturmaTarihi: dogrulanan.olusturmaTarihi === '' ? simdi : dogrulanan.olusturmaTarihi,
      guncellemeTarihi: simdi,
    };
    atomikYaz(projeDosyaYolu(this.veriKoku, damgali.id), JSON.stringify(damgali, null, 2));
    return damgali;
  }

  /**
   * HTTP gövdesi gibi doğrulanmamış bir kaydı yazar. `id` çağırandan gelir
   * (rota parametresi) — gövdedeki `id` yoksayılır, böylece bir projenin
   * gövdesiyle başka bir projenin üzerine yazılamaz.
   */
  guncelle(id: string, ham: unknown): Proje {
    const kaynak = (typeof ham === 'object' && ham !== null ? ham : {}) as Record<string, unknown>;
    return this.yaz(projeDogrula({ ...kaynak, id }, this.ciktiKoku));
  }

  sil(id: string, gorselleriSil: boolean): SilmeSonucu {
    const proje = this.oku(id);
    if (proje === null) {
      return { bulundu: false, silinen: 0, silinemeyen: [], korumaliKlasor: false };
    }

    const gorsel = gorselleriSil
      ? klasorGorselleriniSil(proje.ciktiKlasoru, [homedir(), this.ciktiKoku, this.veriKoku])
      : { silinen: 0, silinemeyen: [], korumaliKlasor: false };

    rmSync(projeDosyaYolu(this.veriKoku, id), { force: true });
    return { bulundu: true, ...gorsel };
  }

  /**
   * Aynı çıktı klasörünü kullanan başka bir proje varsa adını döner.
   * Devam mantığı "PNG diskte varsa satırı atla" olduğu için klasör paylaşan
   * iki proje birbirinin satırlarını bitmiş sayardı.
   */
  private klasorSahibi(klasor: string, hariçId: string): string | null {
    const hedef = resolve(klasor);
    for (const ozet of this.listele().projeler) {
      if (ozet.id === hariçId) continue;
      if (resolve(ozet.ciktiKlasoru) === hedef) return ozet.ad;
    }
    return null;
  }

  private bozukYap(yol: string, sebep: string, hata: unknown): null {
    const bozuk = benzersizYedekYolu(yol, 'bozuk');
    console.error(`proje dosyası ${sebep} (${yol}), "${bozuk}" olarak taşınıyor:`, hata);
    renameSync(yol, bozuk);
    return null;
  }
}
```

- [ ] **Step 5: Testin geçtiğini gör**

Run: `yarn vitest run tests/projeler.test.ts`
Expected: PASS (24 test)

Not: `klasorSahibi` her `yaz()` çağrısında `listele()` koşar (N küçük dosya okuma). Otomatik kaydetme 800 ms'de bir yazdığı ve N ≈ 20 olduğu için ölçülebilir bir maliyet değil; ayrı indeks dosyası tutmanın senkron kalma yükünden daha sağlam.

- [ ] **Step 6: Tüm testleri ve typecheck'i koştur**

Run: `yarn test && yarn typecheck`
Expected: 228 test PASS, typecheck temiz

---

### Task 4: Sunucu — `/api/projeler` rotaları, eski modülün kaldırılması

Bu task tek parça: `src/sunucu/index.ts` `ProjelerDepo`'ya geçtiği anda `src/depo/projeDepo.ts` ve ona bağlı testler derlenemez hale gelir. Hepsi aynı task'ta taşınır.

**Files:**
- Modify: `src/sunucu/index.ts` (tam yeniden yazım)
- Modify: `src/liste.ts` (`satirlariAyristir` eklenir, ölü `listeYukle` kaldırılır)
- Modify: `src/baslat.ts` (satır 4, 22, 55, 85-91)
- Create: `tests/sunucu-projeler.test.ts`
- Delete: `src/depo/projeDepo.ts`, `tests/projeDepo.test.ts`, `tests/sunucu-proje.test.ts`
- Modify: `tests/liste.test.ts`, `tests/sunucu-galeri.test.ts`, `tests/sunucu-bos-govde.test.ts`, `tests/sunucu-yetki-yan-etki.test.ts`, `tests/sunucu-is.test.ts`, `tests/sunucu-tarayici.test.ts`

**Interfaces:**
- Consumes: `ProjelerDepo`, `Proje` (`../depo/projeler.js`), `idGecerliMi` (`../depo/kimlik.js`), `icerdeMi`/`gercekYolIcerdeMi` (`../depo/yollar.js`), `istekYetkili` (`./guvenlik.js`), `onizlemeUret`/`yerTutucuVarMi` (`../prompt.js`)
- Produces:
  - `interface SunucuBagimliliklari { depo: ProjelerDepo; isYoneticisi: IsYoneticisi; isBaslat: (proje: Proje) => void; tarayiciAc: () => Promise<void>; tarayiciAcikMi: () => boolean; token: string; izinliOrigin: () => string; webKlasoru: string; klasoruAc: (yol: string) => void }` — `ciktiKoku` alanı **kaldırıldı** (depo constructor'ına taşındı)
  - `sunucuOlustur(b: SunucuBagimliliklari): FastifyInstance`
  - `mesgulMu(isYoneticisi: IsYoneticisi): boolean`

- [ ] **Step 1: Yeni sunucu testini yaz**

`tests/sunucu-projeler.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjelerDepo } from '../src/depo/projeler.js';
import { IsYoneticisi } from '../src/is/isYoneticisi.js';
import { sunucuOlustur } from '../src/sunucu/index.js';

const TOKEN = 'test-token';
const ORIGIN = 'http://127.0.0.1:3000';

let kok: string;
let depo: ProjelerDepo;
let uygulama: ReturnType<typeof sunucuOlustur>;

beforeEach(() => {
  kok = mkdtempSync(join(tmpdir(), 'sunucu-projeler-'));
  const web = join(kok, 'web');
  mkdirSync(web, { recursive: true });
  writeFileSync(join(web, 'index.html'), '<h1>merhaba</h1>', 'utf-8');
  depo = new ProjelerDepo(kok, join(kok, 'cikti'));

  uygulama = sunucuOlustur({
    depo,
    isYoneticisi: new IsYoneticisi(),
    isBaslat: () => {},
    tarayiciAc: async () => {},
    tarayiciAcikMi: () => true,
    token: TOKEN,
    izinliOrigin: () => ORIGIN,
    webKlasoru: web,
    klasoruAc: () => {},
  });
});

afterEach(async () => {
  await uygulama.close();
  rmSync(kok, { recursive: true, force: true });
});

const yetkili = (ek: Record<string, string> = {}) => ({ 'x-token': TOKEN, origin: ORIGIN, ...ek });

describe('GET /api/projeler', () => {
  it('proje yoksa boş liste döner', async () => {
    const y = await uygulama.inject({ method: 'GET', url: '/api/projeler', headers: yetkili() });
    expect(y.statusCode).toBe(200);
    expect(y.json()).toEqual({ projeler: [], bozukSayisi: 0 });
  });

  it('özet alanlarını döner, satırları taşımaz', async () => {
    depo.olustur('Kedi');
    const y = await uygulama.inject({ method: 'GET', url: '/api/projeler', headers: yetkili() });
    expect(y.json().projeler[0].ad).toBe('Kedi');
    expect(y.json().projeler[0]).not.toHaveProperty('satirlar');
  });
});

describe('POST /api/projeler', () => {
  it('ad ile proje oluşturur ve tam kaydı döner', async () => {
    const y = await uygulama.inject({
      method: 'POST', url: '/api/projeler', headers: yetkili(), payload: { ad: 'Kedi Serisi' },
    });
    expect(y.statusCode).toBe(201);
    expect(y.json().id.startsWith('kedi-serisi-')).toBe(true);
    expect(y.json().basePrompt).toContain('{VARYASYON}');
  });

  it('ad boşsa 400 döner', async () => {
    const y = await uygulama.inject({
      method: 'POST', url: '/api/projeler', headers: yetkili(), payload: { ad: '   ' },
    });
    expect(y.statusCode).toBe(400);
  });
});

describe('GET /api/projeler/:id', () => {
  it('tam kaydı döner', async () => {
    const p = depo.olustur('Kedi');
    const y = await uygulama.inject({
      method: 'GET', url: `/api/projeler/${p.id}`, headers: yetkili(),
    });
    expect(y.statusCode).toBe(200);
    expect(y.json().satirlar).toEqual([]);
  });

  it('bilinmeyen id için 404 döner', async () => {
    const y = await uygulama.inject({
      method: 'GET', url: '/api/projeler/yok-1111', headers: yetkili(),
    });
    expect(y.statusCode).toBe(404);
  });

  it('geçersiz id için 404 döner, dosya sistemine dokunmaz', async () => {
    const y = await uygulama.inject({
      method: 'GET', url: '/api/projeler/BUYUK.HARF', headers: yetkili(),
    });
    expect(y.statusCode).toBe(404);
  });
});

describe('PUT /api/projeler/:id', () => {
  it('kaydeder ve geri okur', async () => {
    const p = depo.olustur('Kedi');
    const yaz = await uygulama.inject({
      method: 'PUT', url: `/api/projeler/${p.id}`, headers: yetkili(),
      payload: { ...p, ad: 'Kedi 2', satirlar: [{ metin: 'karda', dosyaAdi: 'a' }] },
    });
    expect(yaz.statusCode).toBe(200);
    expect(depo.oku(p.id)?.ad).toBe('Kedi 2');
  });

  it('gövdedeki id\'yi yoksayar, yoldaki id kazanır', async () => {
    const p = depo.olustur('Kedi');
    const digeri = depo.olustur('Plaj');

    await uygulama.inject({
      method: 'PUT', url: `/api/projeler/${p.id}`, headers: yetkili(),
      payload: { ...p, id: digeri.id, ad: 'Ezilmeye çalışıldı' },
    });

    expect(depo.oku(digeri.id)?.ad).toBe('Plaj');
    expect(depo.oku(p.id)?.ad).toBe('Ezilmeye çalışıldı');
  });

  it('geçersiz gövdeyi 400 ile reddeder', async () => {
    const p = depo.olustur('Kedi');
    const y = await uygulama.inject({
      method: 'PUT', url: `/api/projeler/${p.id}`, headers: yetkili(),
      payload: { ...p, satirlar: [{ metin: '', dosyaAdi: 'a' }] },
    });
    expect(y.statusCode).toBe(400);
    expect(y.json().hata).toMatch(/boş olamaz/);
  });

  it('boş gövdeyi 400 ile reddeder', async () => {
    const p = depo.olustur('Kedi');
    const y = await uygulama.inject({
      method: 'PUT', url: `/api/projeler/${p.id}`, headers: yetkili(),
    });
    expect(y.statusCode).toBe(400);
  });

  it('başka projenin çıktı klasörünü 400 ile reddeder', async () => {
    const bir = depo.olustur('Kedi');
    const iki = depo.olustur('Plaj');
    const y = await uygulama.inject({
      method: 'PUT', url: `/api/projeler/${iki.id}`, headers: yetkili(),
      payload: { ...iki, ciktiKlasoru: bir.ciktiKlasoru },
    });
    expect(y.statusCode).toBe(400);
    expect(y.json().hata).toMatch(/Kedi/);
  });
});

describe('DELETE /api/projeler/:id', () => {
  it('görselleri silmeden kaydı siler', async () => {
    const p = depo.olustur('Kedi');
    mkdirSync(p.ciktiKlasoru, { recursive: true });
    writeFileSync(join(p.ciktiKlasoru, 'a.png'), 'x');

    const y = await uygulama.inject({
      method: 'DELETE', url: `/api/projeler/${p.id}`, headers: yetkili(),
    });

    expect(y.statusCode).toBe(200);
    expect(y.json().silinen).toBe(0);
    expect(depo.oku(p.id)).toBeNull();
  });

  it('gorselleriSil=1 ile görselleri de siler', async () => {
    const p = depo.olustur('Kedi');
    mkdirSync(p.ciktiKlasoru, { recursive: true });
    writeFileSync(join(p.ciktiKlasoru, 'a.png'), 'x');

    const y = await uygulama.inject({
      method: 'DELETE', url: `/api/projeler/${p.id}?gorselleriSil=1`, headers: yetkili(),
    });

    expect(y.json()).toEqual({ silinen: 1, silinemeyen: [], korumaliKlasor: false });
  });

  it('bilinmeyen id için 404 döner', async () => {
    const y = await uygulama.inject({
      method: 'DELETE', url: '/api/projeler/yok-1111', headers: yetkili(),
    });
    expect(y.statusCode).toBe(404);
  });
});

describe('POST /api/projeler/:id/onizleme', () => {
  it('ilk 3 satırın render edilmiş halini döner', async () => {
    const p = depo.olustur('Kedi');
    const y = await uygulama.inject({
      method: 'POST', url: `/api/projeler/${p.id}/onizleme`, headers: yetkili(),
      payload: {
        basePrompt: 'Bir kedi, {VARYASYON}, detaylı',
        satirlar: [
          { metin: 'karda', dosyaAdi: 'a' }, { metin: 'plajda', dosyaAdi: 'b' },
          { metin: 'ormanda', dosyaAdi: 'c' }, { metin: 'çölde', dosyaAdi: 'd' },
        ],
      },
    });
    expect(y.json().yerTutucuVar).toBe(true);
    expect(y.json().onizleme).toEqual([
      'Bir kedi, karda, detaylı', 'Bir kedi, plajda, detaylı', 'Bir kedi, ormanda, detaylı',
    ]);
  });

  it('yer tutucu yoksa yerTutucuVar false ve boş önizleme döner', async () => {
    const p = depo.olustur('Kedi');
    const y = await uygulama.inject({
      method: 'POST', url: `/api/projeler/${p.id}/onizleme`, headers: yetkili(),
      payload: { basePrompt: 'Bir kedi', satirlar: [{ metin: 'karda', dosyaAdi: 'a' }] },
    });
    expect(y.json().yerTutucuVar).toBe(false);
    expect(y.json().onizleme).toEqual([]);
  });
});
```

- [ ] **Step 2: Çalışan proje kilidi testini yaz**

Aynı dosyanın sonuna ekle. `isCalistir` yardımcısı işi `calisiyor` durumuna sokar; `gorselUret` asılı kaldığı için iş orada durur.

```ts
function isCalistir(uygulama: ReturnType<typeof sunucuOlustur>, projeId: string): void {
  void uygulama.testIsYoneticisi.baslat({
    projeId,
    config: {
      basePrompt: 'a {VARYASYON}', ciktiKlasoru: '/tmp', chromeProfil: '/tmp',
      modelAdi: '', satirArasiBekleme: [0, 0], uretimZamanAsimiSn: 1,
      tekrarDenemeSayisi: 1, rateLimitVarsayilanBeklemeDk: 1,
    },
    satirlar: [{ metin: 'a', dosyaAdi: 'a' }],
    tarayici: {
      baslat: async () => {}, yenidenBaslat: async () => {}, yeniSohbetAc: async () => {},
      oturumAcikMi: async () => true, aktifModelAdi: async () => '',
      gorselUret: () => new Promise(() => {}), // asılı kalır
      sonGorseliKaydet: async () => {}, kapat: async () => {},
    },
    logger: { bilgi: () => {}, uyari: () => {}, hata: () => {} } as never,
    tamamlandiMi: () => false,
    basarisizKaydet: () => {},
    uyuMotoru: async () => {},
  });
}

describe('çalışan proje kilidi', () => {
  it('çalışan projenin PUT ve DELETE isteğini 409 ile reddeder', async () => {
    const p = depo.olustur('Kedi');
    isCalistir(uygulama, p.id);
    await new Promise((c) => setTimeout(c, 10));

    const put = await uygulama.inject({
      method: 'PUT', url: `/api/projeler/${p.id}`, headers: yetkili(), payload: p,
    });
    const sil = await uygulama.inject({
      method: 'DELETE', url: `/api/projeler/${p.id}`, headers: yetkili(),
    });

    expect(put.statusCode).toBe(409);
    expect(sil.statusCode).toBe(409);
    uygulama.testIsYoneticisi.durdur();
  });

  it('çalışmayan başka projenin düzenlenmesine izin verir', async () => {
    const calisan = depo.olustur('Kedi');
    const digeri = depo.olustur('Plaj');
    isCalistir(uygulama, calisan.id);
    await new Promise((c) => setTimeout(c, 10));

    const put = await uygulama.inject({
      method: 'PUT', url: `/api/projeler/${digeri.id}`, headers: yetkili(),
      payload: { ...digeri, ad: 'Plaj 2' },
    });

    expect(put.statusCode).toBe(200);
    uygulama.testIsYoneticisi.durdur();
  });

  it('başka iş çalışırken yeni iş başlatmayı 409 ile reddeder', async () => {
    const calisan = depo.olustur('Kedi');
    const digeri = depo.olustur('Plaj');
    isCalistir(uygulama, calisan.id);
    await new Promise((c) => setTimeout(c, 10));

    const y = await uygulama.inject({
      method: 'POST', url: '/api/is/baslat', headers: yetkili(), payload: { projeId: digeri.id },
    });

    expect(y.statusCode).toBe(409);
    uygulama.testIsYoneticisi.durdur();
  });
});

describe('POST /api/is/baslat', () => {
  it('projeId yoksa 400 döner', async () => {
    const y = await uygulama.inject({
      method: 'POST', url: '/api/is/baslat', headers: yetkili(), payload: {},
    });
    expect(y.statusCode).toBe(400);
  });

  it('bilinmeyen projeId için 404 döner', async () => {
    const y = await uygulama.inject({
      method: 'POST', url: '/api/is/baslat', headers: yetkili(),
      payload: { projeId: 'yok-1111' },
    });
    expect(y.statusCode).toBe(404);
  });

  it('satır yoksa 400 döner', async () => {
    const p = depo.olustur('Kedi');
    const y = await uygulama.inject({
      method: 'POST', url: '/api/is/baslat', headers: yetkili(), payload: { projeId: p.id },
    });
    expect(y.statusCode).toBe(400);
    expect(y.json().hata).toMatch(/satır/);
  });

  it('yer tutucu yoksa 400 döner', async () => {
    const p = depo.olustur('Kedi');
    depo.yaz({ ...p, basePrompt: 'yer tutucusuz', satirlar: [{ metin: 'a', dosyaAdi: 'a' }] });
    const y = await uygulama.inject({
      method: 'POST', url: '/api/is/baslat', headers: yetkili(), payload: { projeId: p.id },
    });
    expect(y.statusCode).toBe(400);
    expect(y.json().hata).toMatch(/VARYASYON/);
  });

  it('geçerli projede 202 döner ve isBaslat çağrılır', async () => {
    let baslatilan = '';
    const kendiUygulama = sunucuOlustur({
      depo, isYoneticisi: new IsYoneticisi(),
      isBaslat: (proje) => { baslatilan = proje.id; },
      tarayiciAc: async () => {}, tarayiciAcikMi: () => true,
      token: TOKEN, izinliOrigin: () => ORIGIN,
      webKlasoru: join(kok, 'web'), klasoruAc: () => {},
    });
    const p = depo.olustur('Kedi');
    depo.yaz({ ...p, satirlar: [{ metin: 'a', dosyaAdi: 'a' }] });

    const y = await kendiUygulama.inject({
      method: 'POST', url: '/api/is/baslat', headers: yetkili(), payload: { projeId: p.id },
    });

    expect(y.statusCode).toBe(202);
    expect(baslatilan).toBe(p.id);
    await kendiUygulama.close();
  });
});
```

- [ ] **Step 3: Testin başarısız olduğunu gör**

Run: `yarn vitest run tests/sunucu-projeler.test.ts`
Expected: FAIL — `ProjelerDepo` tipi `SunucuBagimliliklari.depo` ile uyuşmuyor / `/api/projeler` 404

- [ ] **Step 4: `src/sunucu/index.ts` — bağımlılıklar ve yardımcılar**

Dosyanın 1-36. satırlarını (importlar, `SunucuBagimliliklari`, `declare module`, `MESGUL_DURUMLAR`, `sunucuOlustur` başlangıcı) şununla değiştir:

```ts
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { idGecerliMi } from '../depo/kimlik.js';
import type { Proje, ProjelerDepo } from '../depo/projeler.js';
import { gercekYolIcerdeMi, icerdeMi } from '../depo/yollar.js';
import type { IsYoneticisi } from '../is/isYoneticisi.js';
import { onizlemeUret, yerTutucuVarMi } from '../prompt.js';
import type { Satir } from '../tipler.js';
import { istekYetkili } from './guvenlik.js';

export interface SunucuBagimliliklari {
  depo: ProjelerDepo;
  isYoneticisi: IsYoneticisi;
  isBaslat: (proje: Proje) => void;
  /** Tarayıcıyı iş başlatmadan açar — kullanıcı ChatGPT'ye giriş yapabilsin diye. */
  tarayiciAc: () => Promise<void>;
  tarayiciAcikMi: () => boolean;
  token: string;
  izinliOrigin: () => string;
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

  /** Projeyi okur; yoksa 404 gönderir ve null döner. */
  const projeVeya404 = (id: string, yanit: FastifyReply): Proje | null => {
    const proje = idGecerliMi(id) ? b.depo.oku(id) : null;
    if (proje === null) {
      yanit.code(404).send({ hata: 'proje bulunamadı' });
      return null;
    }
    return proje;
  };

  /** Bu proje şu an üretim yapıyorsa true — düzenleme ve silme kilidi. */
  const projeCalisiyorMu = (id: string): boolean =>
    mesgulMu(b.isYoneticisi) && b.isYoneticisi.bilgi().projeId === id;
```

- [ ] **Step 5: Boş gövde ayrıştırıcısını ve yetki kancasını olduğu gibi bırak**

`addContentTypeParser` bloğu ve `addHook('onRequest', …)` bloğu (mevcut 38-79. satırlar, `GET /` dahil) **değişmez**. Sadece dosyanın devamındaki rotalar yeniden yazılır.

- [ ] **Step 6: Proje rotalarını yaz**

`uygulama.get('/api/proje', …)` ile başlayan bloktan `POST /api/klasoru-ac` bloğunun sonuna kadar olan her şeyi (mevcut 81-220. satırlar) şununla değiştir:

```ts
  uygulama.get('/api/projeler', async () => b.depo.listele());

  uygulama.post('/api/projeler', async (istek, yanit) => {
    const govde = (istek.body ?? {}) as { ad?: unknown };
    const ad = typeof govde.ad === 'string' ? govde.ad.trim() : '';
    if (ad === '') return yanit.code(400).send({ hata: 'proje adı gerekli' });

    try {
      return yanit.code(201).send(b.depo.olustur(ad));
    } catch (hata) {
      return yanit.code(400).send({ hata: (hata as Error).message });
    }
  });

  uygulama.get('/api/projeler/:id', async (istek, yanit) => {
    const { id } = istek.params as { id: string };
    const proje = projeVeya404(id, yanit);
    return proje === null ? yanit : proje;
  });

  uygulama.put('/api/projeler/:id', async (istek, yanit) => {
    const { id } = istek.params as { id: string };
    const mevcut = projeVeya404(id, yanit);
    if (mevcut === null) return yanit;

    if (projeCalisiyorMu(id)) {
      return yanit.code(409).send({ hata: 'bu proje çalışıyor; önce durdurun' });
    }
    // Boş gövde ayrıştırıcıda `undefined` oluyor; açıkça reddet, yoksa
    // projeDogrula varsayılanları döndürüp kullanıcının projesini ezerdi.
    if (istek.body === undefined || istek.body === null) {
      return yanit.code(400).send({ hata: 'proje gövdesi gerekli' });
    }

    try {
      // Yoldaki id kazanır: gövdedeki id ile başka bir projenin üzerine yazılamaz.
      return b.depo.guncelle(id, istek.body);
    } catch (hata) {
      return yanit.code(400).send({ hata: (hata as Error).message });
    }
  });

  uygulama.delete('/api/projeler/:id', async (istek, yanit) => {
    const { id } = istek.params as { id: string };
    if (projeVeya404(id, yanit) === null) return yanit;

    if (projeCalisiyorMu(id)) {
      return yanit.code(409).send({ hata: 'bu proje çalışıyor; önce durdurun' });
    }

    const sorgu = istek.query as { gorselleriSil?: string };
    const sonuc = b.depo.sil(id, sorgu.gorselleriSil === '1');
    return {
      silinen: sonuc.silinen,
      silinemeyen: sonuc.silinemeyen,
      korumaliKlasor: sonuc.korumaliKlasor,
    };
  });

  uygulama.post('/api/projeler/:id/onizleme', async (istek, yanit) => {
    const { id } = istek.params as { id: string };
    if (projeVeya404(id, yanit) === null) return yanit;

    const govde = (istek.body ?? {}) as { basePrompt?: string; satirlar?: Satir[] };
    const basePrompt = govde.basePrompt ?? '';
    const satirlar = Array.isArray(govde.satirlar) ? govde.satirlar : [];
    return {
      yerTutucuVar: yerTutucuVarMi(basePrompt),
      onizleme: onizlemeUret(basePrompt, satirlar),
    };
  });

  uygulama.get('/api/projeler/:id/galeri', async (istek, yanit) => {
    const { id } = istek.params as { id: string };
    const proje = projeVeya404(id, yanit);
    if (proje === null) return yanit;

    if (!existsSync(proje.ciktiKlasoru)) return { dosyalar: [], toplamBayt: 0 };

    const dosyalar = readdirSync(proje.ciktiKlasoru)
      .filter((ad) => ad.toLowerCase().endsWith('.png'))
      .sort();

    // Silme diyaloğu "48 görsel (12,4 MB)" satırını buradan besler; istemci tahmin etmez.
    let toplamBayt = 0;
    for (const ad of dosyalar) {
      try {
        toplamBayt += statSync(join(proje.ciktiKlasoru, ad)).size;
      } catch {
        // dosya arada silinmiş olabilir; toplamı bozmadan geç
      }
    }
    return { dosyalar, toplamBayt };
  });

  uygulama.get('/api/projeler/:id/gorsel/:ad', async (istek, yanit) => {
    const { id, ad } = istek.params as { id: string; ad: string };
    const proje = projeVeya404(id, yanit);
    if (proje === null) return yanit;

    if (!ad.toLowerCase().endsWith('.png')) {
      return yanit.code(400).send({ hata: 'yalnızca png servis edilir' });
    }

    const klasor = proje.ciktiKlasoru;
    const istenen = join(klasor, ad);

    // Önce sözdizimsel kontrol (ucuz, `..` gibi kaba denemeleri eler)
    if (!icerdeMi(klasor, istenen)) {
      return yanit.code(400).send({ hata: 'klasör dışına çıkılamaz' });
    }
    // Sonra symlink çözerek gerçek kontrol — `icerdeMi` symlink çözmez
    const yol = gercekYolIcerdeMi(klasor, istenen);
    if (yol === null) return yanit.code(404).send({ hata: 'görsel bulunamadı' });

    return yanit.type('image/png').send(readFileSync(yol));
  });

  uygulama.post('/api/projeler/:id/klasoru-ac', async (istek, yanit) => {
    const { id } = istek.params as { id: string };
    const proje = projeVeya404(id, yanit);
    if (proje === null) return yanit;

    mkdirSync(proje.ciktiKlasoru, { recursive: true });
    b.klasoruAc(proje.ciktiKlasoru);
    return { acildi: true };
  });
```

- [ ] **Step 7: `GET /api/tarayici`, `/api/tarayici/ac` ve iş rotalarını taşı**

Bu bloklar korunur; yalnızca `POST /api/is/baslat` gövde alır. `uygulama.get('/api/tarayici', …)` ve `uygulama.post('/api/tarayici/ac', …)` bloklarını olduğu gibi bırak, `GET /api/is`'i olduğu gibi bırak, `POST /api/is/baslat` bloğunu şununla değiştir:

```ts
  uygulama.post('/api/is/baslat', async (istek, yanit) => {
    if (mesgulMu(b.isYoneticisi)) {
      return yanit.code(409).send({ hata: 'bir iş zaten çalışıyor' });
    }

    const govde = (istek.body ?? {}) as { projeId?: unknown };
    if (typeof govde.projeId !== 'string') {
      return yanit.code(400).send({ hata: 'projeId gerekli' });
    }
    const proje = projeVeya404(govde.projeId, yanit);
    if (proje === null) return yanit;

    // Tarayıcı açık değilse iş başlatılmaz: kullanıcının ChatGPT'ye giriş
    // yapacak bir anı olmalı, yoksa iş açılır açılmaz sohbete yazmaya başlar.
    if (!b.tarayiciAcikMi()) {
      return yanit.code(409).send({ hata: 'Önce tarayıcıyı açıp ChatGPT\'ye giriş yapın' });
    }
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
```

`duraklat`/`devam`/`durdur`/`kullanici-hazir` döngüsü ve `GET /api/is/akis` bloğu **değişmez**. Dosya sonundaki `return uygulama;` ve `mesgulMu` fonksiyonu da değişmez.

- [ ] **Step 7b: `src/liste.ts`'e saf `satirlariAyristir` ekle, ölü `listeYukle`'yi kaldır**

CSV ayrıştırma yalnızca sunucuda yapılacak (tarayıcı `POST /api/csv/ayristir`
çağırır), bu yüzden dosyadan değil **metinden** ayrıştıran saf bir fonksiyon
gerekiyor. `listeYukle` terminal girişi kaldırıldığında kullanıcısız kaldı;
silinir.

`src/liste.ts` içindeki `listeYukle` fonksiyonunu ve `readFileSync` importunu
sil, yerine şunu ekle:

```ts
/**
 * `metin,dosya_adi` CSV metnini satırlara çevirir. Başlık satırı isteğe
 * bağlı: varsa sütun sırası başlıktan okunur, yoksa ilk alan metin, ikinci
 * alan dosya adı sayılır.
 *
 * Hata mesajlarındaki satır numarası kullanıcının gördüğü CSV satırıdır
 * (başlık dahil, 1'den başlar).
 */
export function satirlariAyristir(icerik: string): Satir[] {
  const ham = csvAyristir(icerik);
  if (ham.length === 0) return [];

  const baslik = ham[0].map((sutun) => sutun.trim().toLowerCase());
  const basliklidir = baslik.includes('metin') && baslik.includes('dosya_adi');

  const metinIdx = basliklidir ? baslik.indexOf('metin') : 0;
  const dosyaIdx = basliklidir ? baslik.indexOf('dosya_adi') : 1;
  const ilkVeri = basliklidir ? 1 : 0;

  const satirlar: Satir[] = [];
  const gorulenAdlar = new Set<string>();

  for (let i = ilkVeri; i < ham.length; i++) {
    const metin = (ham[i][metinIdx] ?? '').trim();
    const dosyaAdi = dosyaAdiTemizle(ham[i][dosyaIdx] ?? '');

    if (metin === '' || dosyaAdi === '') {
      throw new Error(`${i + 1}. satır: "metin" ve "dosya_adi" boş olamaz`);
    }
    if (gorulenAdlar.has(dosyaAdi)) {
      throw new Error(`${i + 1}. satır: "${dosyaAdi}" dosya adı tekrar ediyor`);
    }
    gorulenAdlar.add(dosyaAdi);
    satirlar.push({ metin, dosyaAdi });
  }
  return satirlar;
}
```

`tests/liste.test.ts`: `listeYukle` describe bloğunu ve `listeDosyasiYaz`
yardımcısını (artık kullanılmıyor) sil, yerine ekle:

```ts
describe('satirlariAyristir', () => {
  it('başlıklı CSV\'yi ayrıştırır', () => {
    expect(satirlariAyristir('metin,dosya_adi\nkarda,a\nplajda,b\n')).toEqual([
      { metin: 'karda', dosyaAdi: 'a' },
      { metin: 'plajda', dosyaAdi: 'b' },
    ]);
  });

  it('başlıksız CSV\'yi de ayrıştırır', () => {
    expect(satirlariAyristir('karda,a\n')).toEqual([{ metin: 'karda', dosyaAdi: 'a' }]);
  });

  it('sütun sırası başlıktan okunur', () => {
    expect(satirlariAyristir('dosya_adi,metin\na,karda\n')).toEqual([
      { metin: 'karda', dosyaAdi: 'a' },
    ]);
  });

  it('tırnaklı alanı ve .png uzantısını doğru ele alır', () => {
    expect(satirlariAyristir('"kedi, karda",dag.png\n')).toEqual([
      { metin: 'kedi, karda', dosyaAdi: 'dag' },
    ]);
  });

  it('boş alanı ve tekrar eden dosya adını satır numarasıyla reddeder', () => {
    expect(() => satirlariAyristir('metin,dosya_adi\n,bos\n')).toThrow('2. satır');
    expect(() => satirlariAyristir('metin,dosya_adi\na,ayni\nb,ayni\n')).toThrow('tekrar');
  });

  it('boş metin için boş liste döner', () => {
    expect(satirlariAyristir('')).toEqual([]);
  });
});
```

Import satırını güncelle: `listeYukle` yerine `satirlariAyristir`.

- [ ] **Step 7c: `POST /api/csv/ayristir` rotasını ekle**

`src/sunucu/index.ts`'e (iş rotalarından önce) ekle ve importa `satirlariAyristir`'ı al:

```ts
  // CSV ayrıştırma tek yerde: tarayıcıda ikinci bir ayrıştırıcı olsa kopyalar
  // zamanla ayrışır ve kullanıcının CSV'si tarayıcıda geçip sunucuda reddedilirdi.
  uygulama.post('/api/csv/ayristir', async (istek, yanit) => {
    const govde = (istek.body ?? {}) as { icerik?: unknown };
    if (typeof govde.icerik !== 'string') {
      return yanit.code(400).send({ hata: 'icerik metni gerekli' });
    }
    try {
      return { satirlar: satirlariAyristir(govde.icerik) };
    } catch (hata) {
      return yanit.code(400).send({ hata: (hata as Error).message });
    }
  });
```

`tests/sunucu-projeler.test.ts` sonuna ekle:

```ts
describe('POST /api/csv/ayristir', () => {
  it('CSV metnini satırlara çevirir', async () => {
    const y = await uygulama.inject({
      method: 'POST', url: '/api/csv/ayristir', headers: yetkili(),
      payload: { icerik: 'metin,dosya_adi\nkarda,a\n' },
    });
    expect(y.statusCode).toBe(200);
    expect(y.json().satirlar).toEqual([{ metin: 'karda', dosyaAdi: 'a' }]);
  });

  it('geçersiz CSV\'yi 400 ve satır numaralı mesajla reddeder', async () => {
    const y = await uygulama.inject({
      method: 'POST', url: '/api/csv/ayristir', headers: yetkili(),
      payload: { icerik: 'metin,dosya_adi\na,ayni\nb,ayni\n' },
    });
    expect(y.statusCode).toBe(400);
    expect(y.json().hata).toMatch(/tekrar/);
  });

  it('icerik yoksa 400 döner', async () => {
    const y = await uygulama.inject({
      method: 'POST', url: '/api/csv/ayristir', headers: yetkili(), payload: {},
    });
    expect(y.statusCode).toBe(400);
  });
});
```

- [ ] **Step 8: `src/baslat.ts`'i yeni depoya bağla**

Dört değişiklik:

1. Satır 4 importunu değiştir:

```ts
import { ProjelerDepo, projedenConfig, type Proje } from './depo/projeler.js';
```

2. Satır 22'yi değiştir ve göçü çağır:

```ts
  const depo = new ProjelerDepo(veriKoku, ciktiKoku);
  depo.gocEt();
```

3. Satır 55'teki `projeId`'yi düzelt — 409 kilidi bu alana bakıyor, proje **adı** değil **id** olmalı:

```ts
          projeId: proje.id,
```

4. Satır 85-91'deki `sunucuOlustur` çağrısından `ciktiKoku` alanını çıkar:

```ts
  const uygulama = sunucuOlustur({
    depo, isYoneticisi, isBaslat, token,
    tarayiciAc,
    tarayiciAcikMi: () => tarayici !== null,
    izinliOrigin: () => adres,
    webKlasoru: web, klasoruAc,
  });
```

- [ ] **Step 9: Eski modülü ve testlerini sil**

```bash
rm src/depo/projeDepo.ts tests/projeDepo.test.ts tests/sunucu-proje.test.ts
```

- [ ] **Step 10: Kalan test dosyalarını yeni rotalara taşı**

Dört dosyada mekanik değişiklik. Her birinde `new ProjeDepo(kok)` → `new ProjelerDepo(kok, join(kok, 'cikti'))`, `import { ProjeDepo … } from '../src/depo/projeDepo.js'` → `import { ProjelerDepo } from '../src/depo/projeler.js'`, ve `sunucuOlustur({…})` çağrısından `ciktiKoku` alanını çıkar.

Rota eşlemesi (galeri/görsel/klasör testleri artık bir proje oluşturup id kullanır):

| Eski | Yeni |
|---|---|
| `/api/proje` | `/api/projeler/${p.id}` |
| `/api/proje/onizleme` | `/api/projeler/${p.id}/onizleme` |
| `/api/galeri` | `/api/projeler/${p.id}/galeri` |
| `/api/gorsel/:ad` | `/api/projeler/${p.id}/gorsel/:ad` |
| `/api/klasoru-ac` | `/api/projeler/${p.id}/klasoru-ac` |

- `tests/sunucu-galeri.test.ts`: `beforeEach` içinde `const p = depo.olustur('Kedi')` ekle, görselleri `p.ciktiKlasoru` altına yaz (bugün elle kurulan çıktı klasörü yerine), URL'leri tablodan çevir. Symlink tuzağı ve `..%2F` testleri aynı kalır — yalnızca URL öneki değişir. `GET /api/galeri` describe bloğuna `toplamBayt`ın dosya boyutları toplamını döndürdüğünü doğrulayan bir test ekle.
- `tests/sunucu-bos-govde.test.ts`: gövdesiz POST listesindeki `/api/proje/onizleme` ve `/api/klasoru-ac` yollarını proje id'li hallerine çevir; `/api/proje` PUT satırını `/api/projeler/${p.id}` yap. `/api/is/baslat`'ın gövdesiz çağrıda artık 400 (`projeId gerekli`) döndüğünü beklenen değere yaz.
- `tests/sunucu-yetki-yan-etki.test.ts`: yetkisiz `/api/proje` PUT'unu `/api/projeler/${p.id}` yap, yetkisiz `/api/klasoru-ac` POST'unu proje id'li hale getir. Yan etki iddiaları (klasör açılmadı, proje değişmedi) aynı kalır.
- `tests/sunucu-is.test.ts` ve `tests/sunucu-tarayici.test.ts`: yalnızca `ProjelerDepo` importu, constructor ve `ciktiKoku` alanının çıkarılması. `/api/is/baslat` çağrısı varsa gövdesine `{ projeId: p.id }` ekle.

- [ ] **Step 11: Testleri ve typecheck'i koştur**

Run: `yarn test && yarn typecheck`
Expected: PASS — silinen `tests/projeDepo.test.ts` (18) ve `tests/sunucu-proje.test.ts` (11) düşer, yeni `tests/sunucu-projeler.test.ts` (≈22) eklenir → toplam ≈ 221; typecheck temiz ve `projeDepo.js` importu kalmamış olmalı

- [ ] **Step 12: Eski modüle atıf kalmadığını doğrula**

Run: `grep -rn "projeDepo\|ProjeDepo\b\|varsayilanProje\|ciktiKoku:" src/ tests/ | grep -v "ProjelerDepo"`
Expected: çıktı boş (yalnızca `ProjelerDepo` eşleşmeleri filtrelendi)

---

### Task 5: Cookie token, statik varlık servisi, favicon

UI modüllere bölününce `<script type="module" src="/js/api.js">` isteği ne query ne `x-token` başlığı taşır — bugünkü yetki kancası onu 401 ile reddeder ve UI hiç açılmaz. Bu task o duvarı kaldırır.

**Files:**
- Modify: `src/sunucu/guvenlik.ts`
- Modify: `src/sunucu/index.ts` (yetki kancası, `GET /`, yeni statik rotalar)
- Modify: `tests/guvenlik.test.ts`
- Create: `tests/sunucu-statik.test.ts`

**Interfaces:**
- Consumes: `istekYetkili` (mevcut, imzası değişmez)
- Produces: `cookieTokenOku(baslik: string | undefined): string | undefined`

- [ ] **Step 1: `cookieTokenOku` testini yaz**

`tests/guvenlik.test.ts` dosyasının sonuna ekle:

```ts
import { cookieTokenOku } from '../src/sunucu/guvenlik.js';

describe('cookieTokenOku', () => {
  it('t çerezini okur', () => {
    expect(cookieTokenOku('t=abc123')).toBe('abc123');
  });

  it('birden fazla çerez arasından t\'yi bulur', () => {
    expect(cookieTokenOku('digeri=1; t=abc123; baska=2')).toBe('abc123');
  });

  it('base64url değerindeki eşittir işaretlerini korur', () => {
    expect(cookieTokenOku('t=a=b=c')).toBe('a=b=c');
  });

  it('başlık yoksa veya t yoksa undefined döner', () => {
    expect(cookieTokenOku(undefined)).toBeUndefined();
    expect(cookieTokenOku('digeri=1')).toBeUndefined();
  });

  it('adı t ile başlayan başka çerezi t sanmaz', () => {
    expect(cookieTokenOku('token=yanlis')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Testin başarısız olduğunu gör**

Run: `yarn vitest run tests/guvenlik.test.ts`
Expected: FAIL — `cookieTokenOku` export edilmiyor

- [ ] **Step 3: `src/sunucu/guvenlik.ts` sonuna ekle**

```ts
/**
 * `Cookie` başlığından `t` çerezini okur. Ayrı bir bağımlılık (fastify-cookie)
 * eklemeye değmeyecek kadar küçük bir ihtiyaç.
 */
export function cookieTokenOku(baslik: string | undefined): string | undefined {
  if (baslik === undefined) return undefined;

  for (const parca of baslik.split(';')) {
    const esittir = parca.indexOf('=');
    if (esittir === -1) continue;
    if (parca.slice(0, esittir).trim() !== 't') continue;
    // base64url token'da `=` olabilir; ilk `=`'ten sonrasının tamamı değerdir
    return parca.slice(esittir + 1);
  }
  return undefined;
}
```

- [ ] **Step 4: Testin geçtiğini gör**

Run: `yarn vitest run tests/guvenlik.test.ts`
Expected: PASS

- [ ] **Step 5: Statik servis testini yaz**

`tests/sunucu-statik.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjelerDepo } from '../src/depo/projeler.js';
import { IsYoneticisi } from '../src/is/isYoneticisi.js';
import { sunucuOlustur } from '../src/sunucu/index.js';

const TOKEN = 'test-token';
const ORIGIN = 'http://127.0.0.1:3000';

let kok: string;
let uygulama: ReturnType<typeof sunucuOlustur>;

beforeEach(() => {
  kok = mkdtempSync(join(tmpdir(), 'sunucu-statik-'));
  const web = join(kok, 'web');
  mkdirSync(join(web, 'js'), { recursive: true });
  mkdirSync(join(web, 'css'), { recursive: true });
  writeFileSync(join(web, 'index.html'), '<h1>merhaba</h1>', 'utf-8');
  writeFileSync(join(web, 'js', 'api.js'), 'export const x = 1;', 'utf-8');
  writeFileSync(join(web, 'css', 'stil.css'), 'body{}', 'utf-8');
  writeFileSync(join(kok, 'gizli.txt'), 'sır', 'utf-8');

  uygulama = sunucuOlustur({
    depo: new ProjelerDepo(kok, join(kok, 'cikti')),
    isYoneticisi: new IsYoneticisi(),
    isBaslat: () => {},
    tarayiciAc: async () => {},
    tarayiciAcikMi: () => true,
    token: TOKEN,
    izinliOrigin: () => ORIGIN,
    webKlasoru: web,
    klasoruAc: () => {},
  });
});

afterEach(async () => {
  await uygulama.close();
  rmSync(kok, { recursive: true, force: true });
});

describe('GET / cookie', () => {
  it('token\'ı SameSite=Strict çerezi olarak verir', async () => {
    const y = await uygulama.inject({ method: 'GET', url: `/?t=${TOKEN}` });
    expect(y.statusCode).toBe(200);
    const cerez = String(y.headers['set-cookie']);
    expect(cerez).toContain(`t=${TOKEN}`);
    expect(cerez).toContain('SameSite=Strict');
    expect(cerez).toContain('Path=/');
  });
});

describe('çerez ile yetki', () => {
  it('modül isteğini çerezle kabul eder', async () => {
    const y = await uygulama.inject({
      method: 'GET', url: '/js/api.js', headers: { cookie: `t=${TOKEN}` },
    });
    expect(y.statusCode).toBe(200);
    expect(y.headers['content-type']).toContain('text/javascript');
    expect(y.body).toContain('export const x');
  });

  it('çerezsiz modül isteğini 401 ile reddeder', async () => {
    const y = await uygulama.inject({ method: 'GET', url: '/js/api.js' });
    expect(y.statusCode).toBe(401);
  });

  it('yanlış çerezi reddeder', async () => {
    const y = await uygulama.inject({
      method: 'GET', url: '/js/api.js', headers: { cookie: 't=yanlis' },
    });
    expect(y.statusCode).toBe(401);
  });

  it('API isteğini de çerezle kabul eder', async () => {
    const y = await uygulama.inject({
      method: 'GET', url: '/api/projeler', headers: { cookie: `t=${TOKEN}`, origin: ORIGIN },
    });
    expect(y.statusCode).toBe(200);
  });
});

describe('statik varlıklar', () => {
  it('css servis eder', async () => {
    const y = await uygulama.inject({
      method: 'GET', url: '/css/stil.css', headers: { cookie: `t=${TOKEN}` },
    });
    expect(y.statusCode).toBe(200);
    expect(y.headers['content-type']).toContain('text/css');
  });

  it('web klasörü dışına çıkmaya çalışan isteği reddeder', async () => {
    const y = await uygulama.inject({
      method: 'GET', url: '/js/..%2F..%2Fgizli.txt', headers: { cookie: `t=${TOKEN}` },
    });
    expect([400, 404]).toContain(y.statusCode);
    expect(y.body).not.toContain('sır');
  });

  it('izinli uzantı dışındaki dosyayı reddeder', async () => {
    writeFileSync(join(kok, 'web', 'js', 'gizli.json'), '{}', 'utf-8');
    const y = await uygulama.inject({
      method: 'GET', url: '/js/gizli.json', headers: { cookie: `t=${TOKEN}` },
    });
    expect(y.statusCode).toBe(400);
  });

  it('olmayan dosya için 404 döner', async () => {
    const y = await uygulama.inject({
      method: 'GET', url: '/js/yok.js', headers: { cookie: `t=${TOKEN}` },
    });
    expect(y.statusCode).toBe(404);
  });
});

describe('GET /favicon.ico', () => {
  it('tokensiz bile 204 döner — tarayıcı konsolunu kirletmesin', async () => {
    const y = await uygulama.inject({ method: 'GET', url: '/favicon.ico' });
    expect(y.statusCode).toBe(204);
  });
});
```

- [ ] **Step 6: Testin başarısız olduğunu gör**

Run: `yarn vitest run tests/sunucu-statik.test.ts`
Expected: FAIL — `set-cookie` yok, `/js/api.js` 401/404

- [ ] **Step 7: Yetki kancasını çerez ve favicon için güncelle**

`src/sunucu/index.ts` içindeki `addHook('onRequest', …)` gövdesinin başına favicon muafiyetini, token okumasına da çerezi ekle:

```ts
  uygulama.addHook('onRequest', async (istek, yanit) => {
    // favicon token taşımaz ve 204 döndüğü için bilgi sızdırmaz; muaf tutulmazsa
    // her sayfa yüklemesinde konsola 401 basar.
    if (istek.url.startsWith('/favicon.ico')) return;

    const sorgu = istek.query as Record<string, string | undefined>;
    const basliktan = istek.headers['x-token'];
    const token =
      (typeof basliktan === 'string' ? basliktan : undefined) ??
      sorgu?.t ??
      cookieTokenOku(istek.headers.cookie);
    const origin = istek.headers.origin;

    if (!istekYetkili({ token, origin }, { token: b.token, izinliOrigin: b.izinliOrigin() })) {
      // `return` şart: yanıtı göndermek tek başına istek yaşam döngüsünü
      // durdurmayı garanti etmez.
      return yanit.code(401).send({ hata: 'yetkisiz istek' });
    }
  });
```

Import satırını güncelle:

```ts
import { cookieTokenOku, istekYetkili } from './guvenlik.js';
```

- [ ] **Step 8: `GET /` çerezi bassın**

`GET /` rotasını şununla değiştir:

```ts
  uygulama.get('/', async (_istek, yanit) => {
    const html = readFileSync(join(b.webKlasoru, 'index.html'), 'utf-8');
    // Modül istekleri (`<script type="module" src="/js/…">`) query ya da
    // x-token taşımaz. SameSite=Strict sayesinde kötü niyetli bir sitenin
    // 127.0.0.1'e attığı istek bu çerezi göndermez.
    return yanit
      .header('set-cookie', `t=${b.token}; Path=/; SameSite=Strict`)
      .type('text/html; charset=utf-8')
      .send(html);
  });
```

- [ ] **Step 9: Statik varlık rotalarını ve favicon'u ekle**

`return uygulama;` satırının hemen öncesine ekle:

```ts
  const IZINLI_TURLER: Record<string, string> = {
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
  };

  const varlikServisEt = (altKlasor: string, ad: string, yanit: FastifyReply) => {
    const uzanti = ad.slice(ad.lastIndexOf('.')).toLowerCase();
    const tur = IZINLI_TURLER[uzanti];
    if (tur === undefined) {
      return yanit.code(400).send({ hata: 'bu dosya türü servis edilmiyor' });
    }

    const kok = join(b.webKlasoru, altKlasor);
    const istenen = join(kok, ad);
    if (!icerdeMi(kok, istenen)) {
      return yanit.code(400).send({ hata: 'web klasörü dışına çıkılamaz' });
    }
    const yol = gercekYolIcerdeMi(kok, istenen);
    if (yol === null) return yanit.code(404).send({ hata: 'dosya bulunamadı' });

    return yanit.type(tur).send(readFileSync(yol, 'utf-8'));
  };

  uygulama.get('/js/:ad', async (istek, yanit) =>
    varlikServisEt('js', (istek.params as { ad: string }).ad, yanit));

  uygulama.get('/css/:ad', async (istek, yanit) =>
    varlikServisEt('css', (istek.params as { ad: string }).ad, yanit));

  uygulama.get('/favicon.ico', async (_istek, yanit) => yanit.code(204).send());
```

- [ ] **Step 10: Testleri ve typecheck'i koştur**

Run: `yarn test && yarn typecheck`
Expected: PASS — statik testler (11) + çerez testleri (5) dahil ≈ 237 test; typecheck temiz

---

### Task 6: UI iskeleti — modüller, sol panel, yönlendirme

Buradan sonraki task'larda otomatik test yok (spec §9: `web/` test edilmez, UI mantığı ince tutulur). Doğrulama gerçek sunucu + tarayıcı ile yapılır.

**Files:**
- Modify: `web/index.html` (tam yeniden yazım — iskelet)
- Create: `web/css/stil.css`
- Create: `web/js/api.js`, `web/js/durum.js`, `web/js/projeler.js`, `web/js/uygulama.js`

**Interfaces:**
- Consumes: Task 4 ve 5'in rotaları
- Produces:
  - `api.js`: `api` nesnesi — `projeler()`, `proje(id)`, `projeOlustur(ad)`, `projeKaydet(id, proje)`, `projeSil(id, gorselleriSil)`, `onizleme(id, basePrompt, satirlar)`, `galeri(id)`, `klasoruAc(id)`, `is()`, `isBaslat(projeId)`, `isDuraklat()`, `isDevam()`, `isDurdur()`, `kullaniciHazir()`, `tarayici()`, `tarayiciAc()`
  - `durum.js`: `durum` (nesne), `guncelle(parca)`, `abone(dinleyici) => cozucu`
  - `projeler.js`: `projeleriCiz()`, `projeleriYukle()`, `projeSec(id)`, `yeniProjeSatiriAc()`
  - `uygulama.js`: modül girişi — `baslat()` çağırır, dışa bir şey vermez

- [ ] **Step 1: `web/js/api.js` yaz**

Token `GET /` yanıtındaki çerezle geldiği için ayrı başlık gönderilmiyor.

```js
/** Tüm HTTP çağrıları buradan geçer; hata gövdesi Error.message'a çevrilir. */
async function istek(yol, secenekler = {}) {
  const yanit = await fetch(yol, {
    ...secenekler,
    headers: { 'content-type': 'application/json', ...(secenekler.headers ?? {}) },
  });

  if (!yanit.ok) {
    let mesaj = `${yanit.status} ${yanit.statusText}`;
    try {
      const govde = await yanit.json();
      if (govde && govde.hata) mesaj = govde.hata;
    } catch {
      // gövde JSON değilse durum metni yeterli
    }
    const hata = new Error(mesaj);
    hata.durumKodu = yanit.status;
    throw hata;
  }

  if (yanit.status === 204) return null;
  const tur = yanit.headers.get('content-type') ?? '';
  return tur.includes('application/json') ? yanit.json() : yanit.text();
}

export const api = {
  projeler: () => istek('/api/projeler'),
  proje: (id) => istek(`/api/projeler/${id}`),
  projeOlustur: (ad) =>
    istek('/api/projeler', { method: 'POST', body: JSON.stringify({ ad }) }),
  projeKaydet: (id, proje) =>
    istek(`/api/projeler/${id}`, { method: 'PUT', body: JSON.stringify(proje) }),
  projeSil: (id, gorselleriSil) =>
    istek(`/api/projeler/${id}${gorselleriSil ? '?gorselleriSil=1' : ''}`, { method: 'DELETE' }),
  onizleme: (id, basePrompt, satirlar) =>
    istek(`/api/projeler/${id}/onizleme`, {
      method: 'POST',
      body: JSON.stringify({ basePrompt, satirlar }),
    }),
  galeri: (id) => istek(`/api/projeler/${id}/galeri`),
  klasoruAc: (id) => istek(`/api/projeler/${id}/klasoru-ac`, { method: 'POST' }),

  is: () => istek('/api/is'),
  isBaslat: (projeId) =>
    istek('/api/is/baslat', { method: 'POST', body: JSON.stringify({ projeId }) }),
  isDuraklat: () => istek('/api/is/duraklat', { method: 'POST' }),
  isDevam: () => istek('/api/is/devam', { method: 'POST' }),
  isDurdur: () => istek('/api/is/durdur', { method: 'POST' }),
  kullaniciHazir: () => istek('/api/is/kullanici-hazir', { method: 'POST' }),

  tarayici: () => istek('/api/tarayici'),
  tarayiciAc: () => istek('/api/tarayici/ac', { method: 'POST' }),

  // CSV ayrıştırma sunucuda; tarayıcıda ikinci bir ayrıştırıcı tutulmuyor
  csvAyristir: (icerik) =>
    istek('/api/csv/ayristir', { method: 'POST', body: JSON.stringify({ icerik }) }),
};

/** Görsel URL'si — <img src> için. */
export function gorselUrl(projeId, dosyaAdi) {
  return `/api/projeler/${projeId}/gorsel/${encodeURIComponent(dosyaAdi)}`;
}
```

- [ ] **Step 2: `web/js/durum.js` yaz**

```js
/** Tek istemci durumu. Render fonksiyonları abone olur, guncelle() tetikler. */
export const durum = {
  projeler: [],
  bozukSayisi: 0,
  aktifProje: null,
  /**
   * Düzenlenen satırlar. Tek gerçek kaynak burası: `liste.js` yazar,
   * `editor.js` okur. Böylece iki modül arasında import döngüsü olmaz.
   */
  satirlar: [],
  /** CSV modunda ayrıştırma başarısızsa false — geçersizken kayıt planlanmaz. */
  satirGecerli: true,
  is: {
    durum: 'bosta',
    projeId: null,
    sira: 0,
    toplam: 0,
    ozet: { basarili: 0, atlanan: 0, basarisiz: 0 },
    kalanSn: null,
    mesaj: null,
  },
  galeri: { dosyalar: [], toplamBayt: 0 },
  tarayiciAcik: false,
  /** 'bosta' | 'kaydediliyor' | 'kaydedildi' | 'gecersiz' */
  kaydetDurumu: 'bosta',
  kaydetZamani: null,
  akisBagli: false,
  hata: null,
};

const dinleyiciler = new Set();

export function abone(dinleyici) {
  dinleyiciler.add(dinleyici);
  return () => dinleyiciler.delete(dinleyici);
}

export function guncelle(parca) {
  Object.assign(durum, parca);
  for (const dinleyici of dinleyiciler) dinleyici(durum);
}

/** İş bu projede mi çalışıyor? Salt-okunur kilidi ve şerit buna bakar. */
export function projeCalisiyorMu(projeId) {
  const mesgul = ['calisiyor', 'duraklatildi', 'limitBekliyor', 'kullaniciBekliyor'];
  return mesgul.includes(durum.is.durum) && durum.is.projeId === projeId;
}

export function isMesgulMu() {
  const mesgul = ['calisiyor', 'duraklatildi', 'limitBekliyor', 'kullaniciBekliyor'];
  return mesgul.includes(durum.is.durum);
}
```

- [ ] **Step 3: `web/index.html` iskeletini yaz**

Mevcut tek dosya UI'ın yerine geçer. `<style>` bloğu `css/stil.css`'e, `<script>` bloğu modüllere taşınır.

```html
<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ChatGPT Görsel Üretici</title>
<link rel="stylesheet" href="/css/stil.css">
</head>
<body>

<aside id="yanPanel">
  <div class="yan-baslik">
    <span>Projeler</span>
    <button id="btnYeniProje" title="Yeni proje">+</button>
  </div>
  <p id="bozukUyari" class="bozuk-uyari" hidden></p>
  <nav id="projeListesi"></nav>
</aside>

<div id="govde">
  <div id="isSeridi" hidden></div>

  <header>
    <h1 id="projeAdi">—</h1>
    <span id="kaydetDurum" class="soluk"></span>
    <button id="btnTarayici">1 · Tarayıcıyı aç</button>
    <button id="btnBaslat" class="birincil">2 · Başlat</button>
    <button id="btnDuraklat" disabled>Duraklat</button>
    <button id="btnDevam" disabled>Devam</button>
    <button id="btnDurdur" disabled>Durdur</button>
  </header>

  <main id="bosDurum" hidden>
    <section>
      <h2>Henüz proje yok</h2>
      <p class="soluk">Soldaki <strong>+</strong> ile ilk projeni oluştur.</p>
    </section>
  </main>

  <main id="projeEkrani" hidden>
    <div class="kolon">
      <section id="kilitUyari" hidden>
        <p class="uyari-metin">Bu proje çalışıyor — alanlar salt-okunur. Düzenlemek için durdurun.</p>
      </section>

      <section>
        <h2>Base prompt</h2>
        <textarea id="basePrompt" class="kod" rows="4"></textarea>
        <p class="uyari-metin" id="promptUyari" hidden></p>
        <button id="btnYerTutucu">{VARYASYON} ekle</button>
        <h2 style="margin-top:16px">Önizleme</h2>
        <ol id="onizleme" class="onizleme"></ol>
      </section>

      <section>
        <h2>Satırlar <span id="satirSayisi" class="soluk"></span>
          <button id="btnCsvModu" class="kucuk">CSV olarak düzenle</button>
        </h2>
        <div id="tabloKabi"></div>
        <textarea id="csvAlani" class="kod" rows="10" hidden></textarea>
        <p class="uyari-metin" id="satirUyari" hidden></p>
        <button id="btnSatirEkle">Satır ekle</button>
      </section>

      <section>
        <h2>Ayarlar</h2>
        <div id="ayarlar"></div>
      </section>
    </div>

    <div class="kolon">
      <section>
        <h2>İlerleme</h2>
        <div id="ilerleme"></div>
        <div id="kullaniciKarti" hidden>
          <p class="uyari-metin" id="kullaniciMesaj"></p>
          <button id="btnHazir" class="birincil">Giriş yaptım, devam et</button>
        </div>
      </section>

      <section>
        <h2>Galeri
          <button id="btnKlasor" class="kucuk">Klasörü aç</button>
        </h2>
        <div id="galeri" class="galeri"></div>
      </section>

      <section>
        <h2>Kayıt</h2>
        <div id="kayit" class="kayit"></div>
      </section>
    </div>
  </main>
</div>

<script type="module" src="/js/uygulama.js"></script>
</body>
</html>
```

- [ ] **Step 4: `web/css/stil.css` yaz**

Mevcut `web/index.html` içindeki `<style>` bloğunun tamamını (`:root` değişkenleri, `body`, `header`, `button`, `textarea`, `.ipucu`, `.uyari-metin`, `.hatali`, karanlık tema `@media` bloğu dahil) olduğu gibi bu dosyaya taşı. `main { display: grid; … }` kuralını sil (yerine aşağıdaki `#projeEkrani` geliyor) ve dosyanın sonuna şu kuralları ekle:

```css
/* --- Faz 2B: sol panel + iki kolon --- */
body { display: flex; min-height: 100vh; }

#yanPanel {
  width: 240px; flex: none; display: flex; flex-direction: column;
  background: var(--kart); border-right: 1px solid var(--kenar);
  position: sticky; top: 0; height: 100vh; overflow-y: auto;
}
.yan-baslik {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 14px 8px; font-size: 12px; font-weight: 650;
  letter-spacing: .06em; text-transform: uppercase; color: var(--soluk);
}
.yan-baslik button { padding: 2px 9px; font-size: 16px; line-height: 1; }
#projeListesi { padding: 4px 8px 16px; display: flex; flex-direction: column; gap: 2px; }
.proje-satiri {
  display: flex; align-items: center; gap: 6px; padding: 7px 9px;
  border-radius: 7px; cursor: pointer; font-size: 14px;
}
.proje-satiri:hover { background: var(--zemin); }
.proje-satiri.aktif { background: color-mix(in srgb, var(--vurgu) 16%, transparent); font-weight: 600; }
.proje-satiri .ad { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.proje-satiri .sayi { font-size: 12px; color: var(--soluk); }
.proje-satiri .calisiyor { color: var(--vurgu); }
.proje-satiri .sil { opacity: 0; padding: 1px 6px; font-size: 12px; }
.proje-satiri:hover .sil { opacity: 1; }
.bozuk-uyari { margin: 0 14px 8px; font-size: 12px; color: var(--uyari); }

#govde { flex: 1; min-width: 0; display: flex; flex-direction: column; }
#isSeridi {
  display: flex; align-items: center; gap: 10px; padding: 8px 20px;
  background: color-mix(in srgb, var(--vurgu) 14%, transparent);
  border-bottom: 1px solid var(--kenar); font-size: 13px;
}
#isSeridi .git { margin-left: auto; }

#projeEkrani, #bosDurum {
  display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr);
  gap: 18px; padding: 18px; align-items: start; flex: 1;
}
#bosDurum { grid-template-columns: minmax(0, 560px); }
#projeEkrani[hidden], #bosDurum[hidden] { display: none; }
@media (max-width: 1000px) { #projeEkrani { grid-template-columns: 1fr; } }
.kolon { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.kolon section + section { margin-top: 0; }

button.kucuk { float: right; font-size: 12px; padding: 4px 9px; font-weight: 500; }
.soluk { font-size: 13px; color: var(--soluk); }
.onizleme { margin: 0; padding-left: 22px; font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; }
.onizleme li { margin: 3px 0; color: var(--soluk); }
.galeri { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 6px; }
.galeri img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; border: 1px solid var(--kenar); }
.kayit { max-height: 220px; overflow-y: auto; font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: var(--soluk); }

/* Salt-okunur kilit: çalışan projenin alanları */
.kilitli input, .kilitli textarea, .kilitli button:not(.serbest) { pointer-events: none; opacity: .55; }

.satir-tablosu { width: 100%; border-collapse: collapse; font-size: 13px; }
.satir-tablosu th {
  text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
  color: var(--soluk); font-weight: 600; padding: 0 6px 4px;
}
.satir-tablosu td { padding: 2px 3px; }
.satir-tablosu input { width: 100%; padding: 5px 7px; }
.satir-tablosu input.hatali { border-color: var(--hata); }
.satir-tablosu td.silme { width: 30px; }
.satir-tablosu td.silme button { padding: 3px 7px; font-size: 12px; }
```

- [ ] **Step 5: `web/js/projeler.js` yaz**

```js
import { api } from './api.js';
import { durum, guncelle, projeCalisiyorMu } from './durum.js';

const $ = (id) => document.getElementById(id);

export async function projeleriYukle() {
  const liste = await api.projeler();
  guncelle({ projeler: liste.projeler, bozukSayisi: liste.bozukSayisi });
}

/** Aktif projeyi yükler ve hash'i eşitler. id null ise boş duruma geçer. */
export async function projeSec(id) {
  if (id === null) {
    guncelle({ aktifProje: null, galeri: { dosyalar: [], toplamBayt: 0 } });
    return;
  }
  try {
    const proje = await api.proje(id);
    // Satırlar ayrı tutulur: liste.js onları düzenler, editor.js oradan okur
    guncelle({
      aktifProje: proje,
      satirlar: proje.satirlar.map((s) => ({ ...s })),
      satirGecerli: true,
      hata: null,
    });
    if (location.hash !== `#/proje/${id}`) location.hash = `#/proje/${id}`;
  } catch (hata) {
    // Bilinmeyen id (404): hash'i temizle, ilk projeye düş
    guncelle({ aktifProje: null, hata: hata.message });
    location.hash = '';
    const ilk = durum.projeler[0];
    if (ilk) await projeSec(ilk.id);
  }
}

export function projeleriCiz() {
  const kap = $('projeListesi');
  kap.textContent = '';

  for (const ozet of durum.projeler) {
    const satir = document.createElement('div');
    satir.className = 'proje-satiri';
    if (durum.aktifProje && durum.aktifProje.id === ozet.id) satir.classList.add('aktif');

    const ad = document.createElement('span');
    ad.className = 'ad';
    ad.textContent = ozet.ad;
    satir.append(ad);

    if (projeCalisiyorMu(ozet.id)) {
      const isaret = document.createElement('span');
      isaret.className = 'calisiyor';
      isaret.textContent = '▶';
      satir.append(isaret);
    }

    const sayi = document.createElement('span');
    sayi.className = 'sayi';
    sayi.textContent = String(ozet.satirSayisi);
    satir.append(sayi);

    const sil = document.createElement('button');
    sil.className = 'sil';
    sil.textContent = '×';
    sil.title = 'Projeyi sil';
    sil.addEventListener('click', (olay) => {
      olay.stopPropagation();
      document.dispatchEvent(new CustomEvent('proje-sil-istegi', { detail: ozet }));
    });
    satir.append(sil);

    satir.addEventListener('click', () => void projeSec(ozet.id));
    kap.append(satir);
  }

  const uyari = $('bozukUyari');
  uyari.hidden = durum.bozukSayisi === 0;
  uyari.textContent =
    `${durum.bozukSayisi} proje dosyası okunamadı ve ".bozuk" olarak kenara alındı.`;

  $('bosDurum').hidden = durum.projeler.length > 0;
  $('projeEkrani').hidden = durum.aktifProje === null;
  $('projeAdi').textContent = durum.aktifProje ? durum.aktifProje.ad : '—';
}

/**
 * Sol panelin sonunda düzenlenebilir boş bir satır açar: Enter oluşturur,
 * Esc veya boş bırakıp odak kaybı iptal eder. Ayrı form ekranı yok —
 * "ad yaz, gerisi otomatik" kararının karşılığı.
 */
export function yeniProjeSatiriAc() {
  const kap = $('projeListesi');
  if (kap.querySelector('.yeni-proje-girdisi') !== null) {
    kap.querySelector('.yeni-proje-girdisi').focus();
    return;
  }

  const satir = document.createElement('div');
  satir.className = 'proje-satiri';

  const girdi = document.createElement('input');
  girdi.type = 'text';
  girdi.className = 'yeni-proje-girdisi';
  girdi.placeholder = 'Proje adı…';

  let kapandi = false;
  const kapat = () => {
    if (kapandi) return;
    kapandi = true;
    satir.remove();
  };

  const olustur = async () => {
    const ad = girdi.value.trim();
    if (ad === '') {
      kapat();
      return;
    }
    kapandi = true; // yeniden çizim satırı zaten kaldıracak
    girdi.disabled = true;
    try {
      const proje = await api.projeOlustur(ad);
      await projeleriYukle();
      await projeSec(proje.id);
    } catch (hata) {
      guncelle({ hata: hata.message });
      kapandi = false;
      girdi.disabled = false;
      girdi.focus();
    }
  };

  girdi.addEventListener('keydown', (olay) => {
    if (olay.key === 'Enter') {
      olay.preventDefault();
      void olustur();
    } else if (olay.key === 'Escape') {
      olay.preventDefault();
      kapat();
    }
  });
  girdi.addEventListener('blur', () => void olustur());

  satir.append(girdi);
  kap.append(satir);
  girdi.focus();
}
```

`projeleriCiz` içinde, listeyi yeniden çizerken açık bir yeni-proje girdisi
varsa onu koru — aksi halde her `guncelle()` kullanıcının yazdığı adı silerdi.
`kap.textContent = ''` satırından önce:

```js
  const acikGirdi = kap.querySelector('.yeni-proje-girdisi');
  const acikDeger = acikGirdi === null ? null : acikGirdi.value;
```

ve fonksiyonun sonunda:

```js
  if (acikDeger !== null) {
    yeniProjeSatiriAc();
    kap.querySelector('.yeni-proje-girdisi').value = acikDeger;
  }
```

`web/css/stil.css`'e ekle:

```css
.yeni-proje-girdisi { width: 100%; padding: 4px 6px; font-size: 14px; }
```

- [ ] **Step 6: `web/js/uygulama.js` yaz**

```js
import { abone, durum } from './durum.js';
import { projeSec, projeleriCiz, projeleriYukle, yeniProjeSatiriAc } from './projeler.js';

const $ = (id) => document.getElementById(id);

function hashtenId() {
  const eslesme = location.hash.match(/^#\/proje\/([a-z0-9-]+)$/);
  return eslesme ? eslesme[1] : null;
}

async function yonlendir() {
  const id = hashtenId();
  if (id !== null) {
    if (!durum.aktifProje || durum.aktifProje.id !== id) await projeSec(id);
    return;
  }
  // Hash yoksa: alfabetik ilk proje. Hiç proje yoksa boş durum.
  const ilk = durum.projeler[0];
  await projeSec(ilk ? ilk.id : null);
}

async function baslat() {
  abone(projeleriCiz);

  $('btnYeniProje').addEventListener('click', () => yeniProjeSatiriAc());
  window.addEventListener('hashchange', () => void yonlendir());

  await projeleriYukle();
  await yonlendir();
  projeleriCiz();
}

void baslat();
```

- [ ] **Step 7: Sunucuyu çalıştır ve iskeleti doğrula**

```bash
GORSEL_VERI_KOKU=/tmp/gu-deneme GORSEL_CIKTI_KOKU=/tmp/gu-cikti yarn baslat
```

Tarayıcıda açılan URL'de doğrula:
- Sol panel görünüyor, "Henüz proje yok" boş durumu var
- `+` → ad sor → proje solda çıkıyor, sağda proje ekranı açılıyor, adres çubuğunda `#/proje/<id>` var
- Sayfayı yenile → aynı proje açık kalıyor
- Hash'i elle `#/proje/olmayan-1111` yap → ilk projeye düşüyor
- İkinci proje oluştur → liste alfabetik sıralı
- Tarayıcı konsolunda hata yok (401 dahil)

Sonra sunucuyu `Ctrl+C` ile kapat.

- [ ] **Step 8: Testleri ve typecheck'i koştur**

Run: `yarn test && yarn typecheck`
Expected: PASS — `web/` değişikliği testleri etkilemez

---

### Task 7: Editör — base prompt, önizleme, ayarlar, otomatik kaydetme

**Files:**
- Create: `web/js/kaydet.js`, `web/js/editor.js`
- Modify: `web/js/uygulama.js` (editörü bağla), `web/js/projeler.js` (proje değişiminde bekleyen kaydı boşalt)

**Interfaces:**
- Consumes: `api` (`./api.js`), `durum`/`guncelle`/`projeCalisiyorMu` (`./durum.js`)
- Produces:
  - `kaydet.js`: `kaydetmeyiPlanla(proje)`, `bekleyeniBosalt(): Promise<void>`, `gecersizIsaretle(sebep)`
  - `editor.js`: `editoruBagla()`, `editoruCiz()`, `formdanProje()`

- [ ] **Step 1: `web/js/kaydet.js` yaz**

```js
import { api } from './api.js';
import { guncelle } from './durum.js';
import { projeleriYukle } from './projeler.js';

const GECIKME_MS = 800;

let zamanlayici = null;
let bekleyen = null;

/**
 * Otomatik kaydetme. Açık "Kaydet" butonu çok projede veri kaybı tuzağıydı:
 * düzenle → başka projeye tıkla → değişiklik sessizce giderdi.
 *
 * Yalnızca DOĞRULAMAYI GEÇEN durum buraya gelir; geçersizken çağıran
 * `gecersizIsaretle()` kullanır ve hiç yazma planlanmaz.
 */
export function kaydetmeyiPlanla(proje) {
  bekleyen = proje;
  if (zamanlayici !== null) clearTimeout(zamanlayici);
  zamanlayici = setTimeout(() => void bekleyeniBosalt(), GECIKME_MS);
}

/** Bekleyen kaydı hemen yazar — proje değiştirirken debounce beklenmez. */
export async function bekleyeniBosalt() {
  if (zamanlayici !== null) {
    clearTimeout(zamanlayici);
    zamanlayici = null;
  }
  const proje = bekleyen;
  bekleyen = null;
  if (proje === null) return;

  guncelle({ kaydetDurumu: 'kaydediliyor' });
  try {
    const yazilan = await api.projeKaydet(proje.id, proje);
    guncelle({
      aktifProje: yazilan,
      kaydetDurumu: 'kaydedildi',
      kaydetZamani: new Date().toLocaleTimeString('tr-TR'),
      hata: null,
    });
    await projeleriYukle(); // sol paneldeki ad ve satır sayısı tazelenir
  } catch (hata) {
    guncelle({ kaydetDurumu: 'gecersiz', hata: hata.message });
  }
}

export function gecersizIsaretle(sebep) {
  if (zamanlayici !== null) {
    clearTimeout(zamanlayici);
    zamanlayici = null;
  }
  bekleyen = null;
  guncelle({ kaydetDurumu: 'gecersiz', hata: sebep });
}
```

- [ ] **Step 2: `web/js/editor.js` yaz**

```js
import { api } from './api.js';
import { durum, guncelle, projeCalisiyorMu } from './durum.js';
import { gecersizIsaretle, kaydetmeyiPlanla } from './kaydet.js';

const $ = (id) => document.getElementById(id);

const AYAR_ALANLARI = [
  { anahtar: 'modelAdi', etiket: 'Beklenen model adı', tur: 'text',
    ipucu: 'Boş bırakılırsa model kontrolü atlanır.' },
  { anahtar: 'uretimZamanAsimiSn', etiket: 'Üretim zaman aşımı (sn)', tur: 'number' },
  { anahtar: 'tekrarDenemeSayisi', etiket: 'Tekrar deneme sayısı', tur: 'number' },
  { anahtar: 'rateLimitVarsayilanBeklemeDk', etiket: 'Limit varsayılan bekleme (dk)', tur: 'number' },
];

/** Formdaki her şeyi okuyup tam bir proje nesnesi kurar. */
export function formdanProje() {
  const temel = durum.aktifProje;
  if (temel === null) return null;

  return {
    ...temel,
    basePrompt: $('basePrompt').value,
    ciktiKlasoru: $('ayar-ciktiKlasoru').value.trim(),
    // Satırların tek gerçek kaynağı durum.js; liste.js yazar, burası okur
    satirlar: durum.satirGecerli ? durum.satirlar.map((s) => ({ ...s })) : null,
    ayarlar: {
      modelAdi: $('ayar-modelAdi').value,
      satirArasiBekleme: [Number($('ayar-beklemeMin').value), Number($('ayar-beklemeMaks').value)],
      uretimZamanAsimiSn: Number($('ayar-uretimZamanAsimiSn').value),
      tekrarDenemeSayisi: Number($('ayar-tekrarDenemeSayisi').value),
      rateLimitVarsayilanBeklemeDk: Number($('ayar-rateLimitVarsayilanBeklemeDk').value),
    },
  };
}

/** Kaydetmeden önceki istemci tarafı doğrulama. Hata metni veya null döner. */
function projeyiDogrula(proje) {
  const [min, maks] = proje.ayarlar.satirArasiBekleme;
  if (!Number.isFinite(min) || !Number.isFinite(maks) || min < 0 || min > maks) {
    return 'Bekleme aralığı geçersiz (min ≤ maks olmalı)';
  }
  for (const alan of ['uretimZamanAsimiSn', 'tekrarDenemeSayisi', 'rateLimitVarsayilanBeklemeDk']) {
    if (!Number.isFinite(proje.ayarlar[alan]) || proje.ayarlar[alan] <= 0) {
      return `${alan} pozitif bir sayı olmalı`;
    }
  }
  if (proje.satirlar === null) return 'Satır listesi geçersiz';
  if (proje.ciktiKlasoru === '') return 'Çıktı klasörü boş olamaz';
  return null;
}

/** Değişiklik oldu: önizlemeyi tazele, doğrula, kaydetmeyi planla. */
export async function degisiklikBildir() {
  const proje = formdanProje();
  if (proje === null) return;

  const hata = projeyiDogrula(proje);
  if (hata !== null) {
    gecersizIsaretle(hata);
  } else {
    kaydetmeyiPlanla(proje);
  }

  await onizlemeyiTazele(proje);
  kaydetGostergesiniCiz();
}

async function onizlemeyiTazele(proje) {
  const sonuc = await api.onizleme(proje.id, proje.basePrompt, proje.satirlar ?? []);

  $('promptUyari').hidden = sonuc.yerTutucuVar;
  $('promptUyari').textContent =
    'Prompt içinde {VARYASYON} yok — her satır aynı görseli üretirdi';
  $('basePrompt').classList.toggle('hatali', !sonuc.yerTutucuVar);

  const liste = $('onizleme');
  liste.textContent = '';
  for (const metin of sonuc.onizleme) {
    const oge = document.createElement('li');
    oge.textContent = metin;
    liste.append(oge);
  }
}

export function kaydetGostergesiniCiz() {
  const metinler = {
    bosta: '',
    kaydediliyor: 'Kaydediliyor…',
    kaydedildi: `Kaydedildi ${durum.kaydetZamani ?? ''}`,
    gecersiz: `Geçersiz — kaydedilmedi${durum.hata ? ` (${durum.hata})` : ''}`,
  };
  $('kaydetDurum').textContent = metinler[durum.kaydetDurumu] ?? '';
}

/** Hangi projenin formu doldurulmuş — alan değerlerini gereksiz yazmamak için. */
let cizilenProjeId = null;

/**
 * Her `guncelle()` çağrısında koşar. Alan değerleri YALNIZCA proje
 * değiştiğinde yazılır: `input.value` atamak imleci sonuna atar, kullanıcı
 * yazarken her otomatik kayıt imleci kaçırırdı.
 */
export function editoruCiz() {
  const proje = durum.aktifProje;
  if (proje === null) {
    cizilenProjeId = null;
    return;
  }

  if (cizilenProjeId !== proje.id) {
    $('basePrompt').value = proje.basePrompt;
    ayarlariCiz(proje);
    cizilenProjeId = proje.id;
    void onizlemeyiTazele(formdanProje());
  }

  const kilitli = projeCalisiyorMu(proje.id);
  $('kilitUyari').hidden = !kilitli;
  $('projeEkrani').classList.toggle('kilitli', kilitli);

  kaydetGostergesiniCiz();
}

function ayarlariCiz(proje) {
  const kap = $('ayarlar');
  if (kap.dataset.kuruldu === '1') {
    // Alanlar zaten var; yalnızca değerleri yaz — yazarken imleç kaybolmasın
    $('ayar-modelAdi').value = proje.ayarlar.modelAdi;
    $('ayar-ciktiKlasoru').value = proje.ciktiKlasoru;
    $('ayar-beklemeMin').value = proje.ayarlar.satirArasiBekleme[0];
    $('ayar-beklemeMaks').value = proje.ayarlar.satirArasiBekleme[1];
    for (const alan of AYAR_ALANLARI.slice(1)) {
      $(`ayar-${alan.anahtar}`).value = proje.ayarlar[alan.anahtar];
    }
    return;
  }

  kap.textContent = '';

  // Çıktı klasörü `ayarlar` içinde değil, projenin kök alanı — ama kullanıcı
  // için bir ayar. Ad değişince otomatik değişmez (spec §3): üretilmiş
  // görseller eski klasörde yalnız kalmasın.
  const klasorEtiket = document.createElement('label');
  klasorEtiket.textContent = 'Çıktı klasörü';
  klasorEtiket.title = 'İki proje aynı klasörü kullanamaz.';
  const klasorGirdi = document.createElement('input');
  klasorGirdi.type = 'text';
  klasorGirdi.id = 'ayar-ciktiKlasoru';
  klasorGirdi.value = proje.ciktiKlasoru;
  kap.append(klasorEtiket, klasorGirdi);

  const beklemeEtiket = document.createElement('label');
  beklemeEtiket.textContent = 'Satır arası bekleme (sn, min – maks)';
  kap.append(beklemeEtiket);
  const beklemeKap = document.createElement('div');
  beklemeKap.className = 'satir';
  for (const [id, deger] of [
    ['ayar-beklemeMin', proje.ayarlar.satirArasiBekleme[0]],
    ['ayar-beklemeMaks', proje.ayarlar.satirArasiBekleme[1]],
  ]) {
    const girdi = document.createElement('input');
    girdi.type = 'number';
    girdi.id = id;
    girdi.min = '0';
    girdi.value = String(deger);
    beklemeKap.append(girdi);
  }
  kap.append(beklemeKap);

  for (const alan of AYAR_ALANLARI) {
    const etiket = document.createElement('label');
    etiket.textContent = alan.etiket;
    if (alan.ipucu) etiket.title = alan.ipucu;
    const girdi = document.createElement('input');
    girdi.type = alan.tur;
    girdi.id = `ayar-${alan.anahtar}`;
    if (alan.tur === 'number') girdi.min = '1';
    girdi.value = String(proje.ayarlar[alan.anahtar]);
    kap.append(etiket, girdi);
  }

  kap.dataset.kuruldu = '1';
  kap.addEventListener('input', () => void degisiklikBildir());
}

export function editoruBagla() {
  $('basePrompt').addEventListener('input', () => void degisiklikBildir());

  $('btnYerTutucu').addEventListener('click', () => {
    const alan = $('basePrompt');
    const bas = alan.selectionStart ?? alan.value.length;
    alan.value = `${alan.value.slice(0, bas)}{VARYASYON}${alan.value.slice(bas)}`;
    alan.focus();
    void degisiklikBildir();
  });
}
```

- [ ] **Step 3: `web/js/projeler.js` — proje değişiminde bekleyen kaydı boşalt**

`projeSec` fonksiyonunun ilk satırına ekle (import'u da ekle: `import { bekleyeniBosalt } from './kaydet.js';`):

```js
export async function projeSec(id) {
  // Bekleyen otomatik kaydetme varsa debounce beklemeden yaz — proje
  // değiştirirken değişiklik kaybolmasın.
  await bekleyeniBosalt();
  if (id === null) {
```

Not: `kaydet.js` `projeler.js`'i, `projeler.js` de `kaydet.js`'i import ediyor. ES modülleri döngüsel importu çözer; her iki modül de fonksiyonları çağrı anında kullandığı için (yükleme anında değil) sorun çıkmaz.

- [ ] **Step 4: `web/js/uygulama.js`'e editörü bağla**

Import ve abonelik ekle:

```js
import { editoruBagla, editoruCiz } from './editor.js';
```

`baslat()` içinde:

```js
  abone(projeleriCiz);
  abone(editoruCiz);
  editoruBagla();
```

- [ ] **Step 5: Tarayıcıda doğrula**

```bash
GORSEL_VERI_KOKU=/tmp/gu-deneme GORSEL_CIKTI_KOKU=/tmp/gu-cikti yarn baslat
```

- Prompt'a yaz → 800 ms sonra "Kaydedildi HH:MM:SS" görünüyor
- Sayfayı yenile → yazdığın metin duruyor
- `{VARYASYON}`'u sil → alan kırmızı, uyarı çıkıyor (kayıt yine yapılır; yer tutucu kuralı iş başlatmayı engeller, kaydetmeyi değil)
- "{VARYASYON} ekle" imlecin olduğu yere ekliyor
- Bekleme min'i maks'tan büyük yap → "Geçersiz — kaydedilmedi" çıkıyor, yenileyince eski değer duruyor
- Prompt'a yaz, 800 ms geçmeden solda başka projeye tıkla → geri döndüğünde yazdığın duruyor
- Konsolda hata yok

- [ ] **Step 6: Testleri koştur**

Run: `yarn test && yarn typecheck`
Expected: PASS

---

### Task 8: Satır listesi — tablo editörü ve CSV modu

**Files:**
- Create: `web/js/liste.js`
- Modify: `web/js/uygulama.js` (listeyi bağla)

**Interfaces:**
- Consumes: `api` (`./api.js`, `csvAyristir` çağrısı için), `durum`/`guncelle` (`./durum.js`), `degisiklikBildir` (`./editor.js`)
- Produces: `listeyiBagla()`, `listeyiCiz()`
- Satırları `durum.satirlar` / `durum.satirGecerli` üzerinden yazar; `editor.js` oradan okur (import yönü tek: liste → editor)

- [ ] **Step 1: `web/js/liste.js` yaz**

```js
import { api } from './api.js';
import { durum, guncelle } from './durum.js';
import { degisiklikBildir } from './editor.js';

const $ = (id) => document.getElementById(id);

/** Tablo mu CSV mi düzenleniyor. */
let csvModu = false;

/**
 * Satırların tek gerçek kaynağı `durum.satirlar`. Bu modül yazar, `editor.js`
 * okur — böylece iki modül arasında import döngüsü olmaz (import yönü tek:
 * liste → editor).
 */
const satirlar = () => durum.satirlar;

function satirlariYaz(yeni, gecerli = true) {
  guncelle({ satirlar: yeni, satirGecerli: gecerli });
}

/**
 * CSV modunda ayrıştırmayı sunucuya yaptırır; başarısızsa durumu geçersiz
 * işaretler ve hata mesajını döner. Ayrıştırma tarayıcıda tekrarlanmıyor:
 * iki kopya zamanla ayrışır ve kullanıcının CSV'si tarayıcıda geçip sunucuda
 * reddedilirdi.
 */
async function csvdenTazele() {
  try {
    const sonuc = await api.csvAyristir($('csvAlani').value);
    satirlariYaz(sonuc.satirlar, true);
    return null;
  } catch (hata) {
    guncelle({ satirGecerli: false });
    return hata.message;
  }
}

/**
 * Satırları CSV metnine çevirir. Bu yön (serileştirme) tarayıcıda kalıyor:
 * ayrıştırma kurallarının aksine tek satırlık kaçış mantığı, sunucuya gidip
 * gelmeye değmez.
 */
function csveCevir(kayitlar) {
  const kacis = (alan) => (/[",\n]/.test(alan) ? `"${alan.replaceAll('"', '""')}"` : alan);
  return ['metin,dosya_adi', ...kayitlar.map((s) => `${kacis(s.metin)},${kacis(s.dosyaAdi)}`)]
    .join('\n');
}

/** Aktif proje değiştiğinde iç veriyi tazeler. */
export function listeyiCiz() {
  if (durum.aktifProje === null) return;

  // Kullanıcı yazarken tabloyu yeniden kurmak imleci kaybettirir; yalnızca
  // proje kimliği değiştiyse iç veri baştan yüklenir.
  if ($('tabloKabi').dataset.projeId !== durum.aktifProje.id) {
    $('tabloKabi').dataset.projeId = durum.aktifProje.id;
    csvModu = false;
    tabloyuCiz();
  }
  modKabuguCiz();
}

function modKabuguCiz() {
  $('tabloKabi').hidden = csvModu;
  $('csvAlani').hidden = !csvModu;
  $('btnSatirEkle').hidden = csvModu;
  $('btnCsvModu').textContent = csvModu ? 'Tablo olarak düzenle' : 'CSV olarak düzenle';
  $('satirSayisi').textContent = `(${satirlar().length})`;
}

function tabloyuCiz() {
  const kap = $('tabloKabi');
  kap.textContent = '';

  const tablo = document.createElement('table');
  tablo.className = 'satir-tablosu';
  const bas = document.createElement('tr');
  for (const baslik of ['Metin (varyasyon)', 'Dosya adı', '']) {
    const hucre = document.createElement('th');
    hucre.textContent = baslik;
    bas.append(hucre);
  }
  tablo.append(bas);

  const tekrarlayan = tekrarlayanAdlar();

  satirlar().forEach((satir, sira) => {
    const tr = document.createElement('tr');

    for (const alan of ['metin', 'dosyaAdi']) {
      const td = document.createElement('td');
      const girdi = document.createElement('input');
      girdi.type = 'text';
      girdi.value = satir[alan];
      girdi.placeholder = alan === 'metin' ? 'kar yağarken dağ evinde' : 'dag_evi_kis';
      const bos = satir[alan].trim() === '';
      const cakisma = alan === 'dosyaAdi' && tekrarlayan.has(satir.dosyaAdi);
      girdi.classList.toggle('hatali', bos || cakisma);
      if (cakisma) girdi.title = 'Bu dosya adı başka satırda da var';

      girdi.addEventListener('input', () => {
        // Diziyi yerinde değiştirip aynı referansı geri yazıyoruz: tabloyu
        // yeniden kurmadığımız için imleç yerinde kalır.
        const guncel = satirlar();
        guncel[sira][alan] = girdi.value;
        satirlariYaz(guncel, true);
        isaretleriTazele();
        void bildir();
      });
      td.append(girdi);
      tr.append(td);
    }

    const silHucre = document.createElement('td');
    silHucre.className = 'silme';
    const sil = document.createElement('button');
    sil.textContent = '×';
    sil.title = 'Satırı sil';
    sil.addEventListener('click', () => {
      const guncel = satirlar();
      guncel.splice(sira, 1);
      satirlariYaz(guncel, true);
      tabloyuCiz();
      modKabuguCiz();
      void bildir();
    });
    silHucre.append(sil);
    tr.append(silHucre);

    tablo.append(tr);
  });

  kap.append(tablo);
}

function tekrarlayanAdlar() {
  const sayim = new Map();
  for (const satir of satirlar()) {
    const ad = satir.dosyaAdi.trim();
    if (ad !== '') sayim.set(ad, (sayim.get(ad) ?? 0) + 1);
  }
  return new Set([...sayim].filter(([, adet]) => adet > 1).map(([ad]) => ad));
}

/** Tabloyu yeniden kurmadan yalnızca kırmızı işaretleri güncelle. */
function isaretleriTazele() {
  const tekrarlayan = tekrarlayanAdlar();
  const satirlarDom = $('tabloKabi').querySelectorAll('tr');

  satirlarDom.forEach((tr, sira) => {
    if (sira === 0) return; // başlık
    const veri = satirlar()[sira - 1];
    if (veri === undefined) return;
    const girdiler = tr.querySelectorAll('input');
    girdiler[0]?.classList.toggle('hatali', veri.metin.trim() === '');
    girdiler[1]?.classList.toggle(
      'hatali',
      veri.dosyaAdi.trim() === '' || tekrarlayan.has(veri.dosyaAdi),
    );
  });
  $('satirSayisi').textContent = `(${satirlar().length})`;
}

/** Doğrulama sonucunu uyarı satırına yazar, sonra editöre haber verir. */
async function bildir() {
  const uyari = $('satirUyari');

  if (csvModu) {
    const hata = await csvdenTazele();
    uyari.hidden = hata === null;
    uyari.textContent = hata === null ? '' : `CSV geçersiz — ${hata}`;
  } else {
    // Tablo modunda boş/tekrarlayan hücreler kırmızı görünür; sunucu 400 döner
    // ve gösterge "Geçersiz — kaydedilmedi" der.
    const bozuk = satirlar().some((s) => s.metin.trim() === '' || s.dosyaAdi.trim() === '') ||
      tekrarlayanAdlar().size > 0;
    uyari.hidden = !bozuk;
    uyari.textContent = bozuk ? 'Boş veya tekrar eden satır var — kaydedilmiyor' : '';
  }

  await degisiklikBildir();
}

export function listeyiBagla() {
  $('btnSatirEkle').addEventListener('click', () => {
    satirlariYaz([...satirlar(), { metin: '', dosyaAdi: '' }], true);
    tabloyuCiz();
    modKabuguCiz();
  });

  $('btnCsvModu').addEventListener('click', async () => {
    if (!csvModu) {
      $('csvAlani').value = csveCevir(satirlar());
      csvModu = true;
    } else {
      const hata = await csvdenTazele();
      if (hata !== null) {
        // CSV geçersizken tabloya dönmek veriyi kaybettirir
        $('satirUyari').hidden = false;
        $('satirUyari').textContent = `CSV geçersiz — tabloya dönmeden önce düzeltin (${hata})`;
        return;
      }
      csvModu = false;
      tabloyuCiz();
    }
    modKabuguCiz();
    void bildir();
  });

  $('csvAlani').addEventListener('input', () => void bildir());
}
```

Not: satırların tek gerçek kaynağı `durum.satirlar`; DOM'dan okuma yapılmaz. `editor.js` bu diziyi okur, bu modül yazar — import yönü tek (liste → editor), döngü yok.

Tablo modunda boş veya tekrar eden hücre varsa kayıt yine gönderilir ve **sunucu** 400 ile reddeder; gösterge "Geçersiz — kaydedilmedi" der, kullanıcı kırmızı hücreden nedenini görür. CSV modunda ayrıştırma hatası istemcide yakalanır ve `satirGecerli: false` ile kayıt hiç planlanmaz.

- [ ] **Step 2: `web/js/uygulama.js`'e listeyi bağla**

```js
import { listeyiBagla, listeyiCiz } from './liste.js';
```

`baslat()` içinde, `abone(editoruCiz)` satırından **önce** `abone(listeyiCiz)` ekle (editör önizlemeyi çizerken satırlar hazır olsun) ve `listeyiBagla()` çağır:

```js
  abone(projeleriCiz);
  abone(listeyiCiz);
  abone(editoruCiz);
  editoruBagla();
  listeyiBagla();
```

- [ ] **Step 3: Tarayıcıda doğrula**

- Tablo görünüyor, "Satır ekle" boş satır açıyor
- İki satıra aynı dosya adını yaz → ikisi de kırmızı, gösterge "Geçersiz — kaydedilmedi"
- Adı düzelt → kaydediliyor, yenileyince duruyor
- "CSV olarak düzenle" → `metin,dosya_adi` başlıklı CSV çıkıyor, satırlar doğru
- CSV'ye 3 satır yapıştır → "Tablo olarak düzenle" → tabloda 3 satır
- CSV'de bir satırın virgülünü sil (tek alan bırak) → uyarı çıkıyor, tabloya dönüş engelleniyor
- Satır sil → sayaç düşüyor, kaydediliyor

- [ ] **Step 4: Testleri koştur**

Run: `yarn test && yarn typecheck`
Expected: PASS

---

### Task 9: Sağ kolon — canlı ilerleme, iş butonları, galeri, üst şerit

**Files:**
- Create: `web/js/akis.js`, `web/js/ilerleme.js`, `web/js/galeri.js`
- Modify: `web/js/uygulama.js`, `web/js/projeler.js` (proje seçildiğinde galeriyi yükle)

**Interfaces:**
- Consumes: `api`/`gorselUrl` (`./api.js`), `durum`/`guncelle`/`projeCalisiyorMu`/`isMesgulMu` (`./durum.js`)
- Produces:
  - `akis.js`: `akisiBaslat()`
  - `ilerleme.js`: `ilerlemeyiBagla()`, `ilerlemeyiCiz()`, `kayitEkle(metin)`
  - `galeri.js`: `galeriyiYukle(projeId)`, `galeriyiCiz()`

- [ ] **Step 1: `web/js/galeri.js` yaz**

```js
import { api, gorselUrl } from './api.js';
import { durum, guncelle } from './durum.js';

const $ = (id) => document.getElementById(id);

export async function galeriyiYukle(projeId) {
  if (projeId === null) {
    guncelle({ galeri: { dosyalar: [], toplamBayt: 0 } });
    return;
  }
  try {
    guncelle({ galeri: await api.galeri(projeId) });
  } catch {
    guncelle({ galeri: { dosyalar: [], toplamBayt: 0 } });
  }
}

export function galeriyiCiz() {
  const kap = $('galeri');
  const proje = durum.aktifProje;
  if (proje === null) {
    kap.textContent = '';
    return;
  }

  // Aynı dosya listesi tekrar çizilmesin — <img> yeniden yüklenmesi titrer
  const imza = `${proje.id}:${durum.galeri.dosyalar.join(',')}`;
  if (kap.dataset.imza === imza) return;
  kap.dataset.imza = imza;

  kap.textContent = '';
  for (const dosyaAdi of durum.galeri.dosyalar) {
    const gorsel = document.createElement('img');
    gorsel.src = gorselUrl(proje.id, dosyaAdi);
    gorsel.alt = dosyaAdi;
    gorsel.title = dosyaAdi;
    gorsel.loading = 'lazy';
    kap.append(gorsel);
  }
  if (durum.galeri.dosyalar.length === 0) {
    const bos = document.createElement('p');
    bos.className = 'soluk';
    bos.textContent = 'Henüz görsel yok.';
    kap.append(bos);
  }
}
```

- [ ] **Step 2: `web/js/ilerleme.js` yaz**

```js
import { api } from './api.js';
import { durum, guncelle, isMesgulMu, projeCalisiyorMu } from './durum.js';
import { projeSec } from './projeler.js';

const $ = (id) => document.getElementById(id);

const DURUM_METINLERI = {
  bosta: 'Henüz çalıştırılmadı',
  calisiyor: 'Çalışıyor',
  duraklatildi: 'Duraklatıldı',
  limitBekliyor: 'Rate limit — bekleniyor',
  kullaniciBekliyor: 'Sizi bekliyor',
  bitti: 'Bitti',
  durduruldu: 'Durduruldu',
  hata: 'Hata',
};

export function kayitEkle(metin) {
  const satir = document.createElement('div');
  satir.textContent = `${new Date().toLocaleTimeString('tr-TR')} ${metin}`;
  $('kayit').prepend(satir);
  while ($('kayit').childElementCount > 200) $('kayit').lastElementChild.remove();
}

export function ilerlemeyiCiz() {
  const proje = durum.aktifProje;
  const is = durum.is;
  const buProje = proje !== null && projeCalisiyorMu(proje.id);

  const kap = $('ilerleme');
  kap.textContent = '';

  // SSE koptuysa ekrandaki sayılar donmuş olabilir; bunu saklamak yanıltıcı olur
  if (!durum.akisBagli) {
    const kopuk = document.createElement('p');
    kopuk.className = 'uyari-metin';
    kopuk.textContent = 'Canlı bağlantı yok — yeniden bağlanılıyor…';
    kap.append(kopuk);
  }

  const baslik = document.createElement('p');
  baslik.textContent = buProje || (proje !== null && is.projeId === proje.id)
    ? DURUM_METINLERI[is.durum] ?? is.durum
    : DURUM_METINLERI.bosta;
  kap.append(baslik);

  if (buProje) {
    const sayac = document.createElement('p');
    sayac.className = 'soluk';
    sayac.textContent =
      `${is.sira}/${is.toplam} · ✓ ${is.ozet.basarili} · atlanan ${is.ozet.atlanan} · ✗ ${is.ozet.basarisiz}`;
    kap.append(sayac);

    if (is.durum === 'limitBekliyor' && is.kalanSn !== null) {
      const geri = document.createElement('p');
      geri.className = 'uyari-metin';
      geri.textContent = `Limit bekleniyor — kalan ${is.kalanSn} sn`;
      kap.append(geri);
    }
  }

  const kullaniciGerekli = buProje && is.durum === 'kullaniciBekliyor';
  $('kullaniciKarti').hidden = !kullaniciGerekli;
  $('kullaniciMesaj').textContent = is.mesaj ?? '';

  butonlariCiz();
  seridiCiz();
}

function butonlariCiz() {
  const proje = durum.aktifProje;
  const buProje = proje !== null && projeCalisiyorMu(proje.id);
  const baskaIsVar = isMesgulMu() && !buProje;

  $('btnTarayici').textContent = durum.tarayiciAcik ? '✓ Tarayıcı açık' : '1 · Tarayıcıyı aç';
  $('btnTarayici').disabled = durum.tarayiciAcik;

  $('btnBaslat').disabled = proje === null || isMesgulMu() || !durum.tarayiciAcik;
  $('btnBaslat').title = baskaIsVar
    ? 'Bir iş zaten çalışıyor'
    : (!durum.tarayiciAcik ? 'Önce tarayıcıyı açıp ChatGPT\'ye giriş yapın' : '');

  $('btnDuraklat').disabled = !buProje || durum.is.durum === 'duraklatildi';
  $('btnDevam').disabled = !buProje || durum.is.durum !== 'duraklatildi';
  $('btnDurdur').disabled = !buProje;
}

function seridiCiz() {
  const serit = $('isSeridi');
  if (!isMesgulMu() || durum.is.projeId === null) {
    serit.hidden = true;
    return;
  }

  const ozet = durum.projeler.find((p) => p.id === durum.is.projeId);
  serit.hidden = false;
  serit.textContent = '';

  const metin = document.createElement('span');
  metin.textContent =
    `▶ ${ozet ? ozet.ad : durum.is.projeId} — ${durum.is.sira}/${durum.is.toplam}`;
  serit.append(metin);

  // Kullanıcı başka projeye gezmişken şerit kaybolmaz; tek iş kısıtının
  // görünür karşılığı.
  if (durum.aktifProje === null || durum.aktifProje.id !== durum.is.projeId) {
    const git = document.createElement('button');
    git.className = 'git';
    git.textContent = 'Projeye git';
    git.addEventListener('click', () => void projeSec(durum.is.projeId));
    serit.append(git);
  }
}

async function tarayiciDurumunuTazele() {
  try {
    guncelle({ tarayiciAcik: (await api.tarayici()).acik });
  } catch {
    guncelle({ tarayiciAcik: false });
  }
}

export function ilerlemeyiBagla() {
  $('btnTarayici').addEventListener('click', async () => {
    $('btnTarayici').disabled = true;
    $('btnTarayici').textContent = 'Açılıyor…';
    try {
      await api.tarayiciAc();
      kayitEkle('tarayıcı açıldı — ChatGPT\'ye giriş yapın');
    } catch (hata) {
      kayitEkle(`tarayıcı açılamadı: ${hata.message}`);
    }
    await tarayiciDurumunuTazele();
  });

  $('btnBaslat').addEventListener('click', async () => {
    if (durum.aktifProje === null) return;
    try {
      await api.isBaslat(durum.aktifProje.id);
    } catch (hata) {
      kayitEkle(`başlatılamadı: ${hata.message}`);
    }
  });

  const eylemler = [
    ['btnDuraklat', api.isDuraklat],
    ['btnDevam', api.isDevam],
    ['btnDurdur', api.isDurdur],
    ['btnHazir', api.kullaniciHazir],
  ];
  for (const [id, eylem] of eylemler) {
    $(id).addEventListener('click', async () => {
      try {
        await eylem();
      } catch (hata) {
        kayitEkle(hata.message);
      }
    });
  }

  void tarayiciDurumunuTazele();
}
```

- [ ] **Step 3: `web/js/akis.js` yaz**

```js
import { durum, guncelle } from './durum.js';
import { galeriyiYukle } from './galeri.js';
import { kayitEkle } from './ilerleme.js';
import { projeleriYukle } from './projeler.js';

/**
 * SSE, `EventSource` ile açılır ve başlık eklenemez — token bu yüzden
 * çerezle taşınıyor (aynı origin olduğu için çerez otomatik gider).
 */
export function akisiBaslat() {
  const kaynak = new EventSource('/api/is/akis');

  kaynak.addEventListener('open', () => guncelle({ akisBagli: true }));

  kaynak.addEventListener('error', () => {
    // EventSource kendisi yeniden bağlanır; sadece göstergeyi düşür
    guncelle({ akisBagli: false });
  });

  kaynak.addEventListener('message', (olay) => {
    let veri;
    try {
      veri = JSON.parse(olay.data);
    } catch {
      return;
    }
    void olayIsle(veri);
  });
}

async function olayIsle(olay) {
  const is = { ...durum.is };

  switch (olay.tip) {
    case 'durum':
      is.durum = olay.durum;
      is.projeId = olay.projeId;
      is.ozet = olay.ozet;
      if (olay.durum !== 'limitBekliyor') is.kalanSn = null;
      if (olay.durum !== 'kullaniciBekliyor') is.mesaj = null;
      guncelle({ is, akisBagli: true });
      return;

    case 'satirBasladi':
      is.sira = olay.sira;
      is.toplam = olay.toplam;
      guncelle({ is });
      kayitEkle(`${olay.sira}/${olay.toplam} ${olay.dosyaAdi} başladı`);
      return;

    case 'gorselHazir':
      kayitEkle(`${olay.dosyaAdi} hazır`);
      // Galeri yalnızca ekranda o proje açıksa tazelenir
      if (durum.aktifProje !== null && durum.aktifProje.id === durum.is.projeId) {
        await galeriyiYukle(durum.aktifProje.id);
      }
      return;

    case 'satirBitti':
      kayitEkle(`${olay.sira}. satır: ${olay.sonuc}${olay.sebep ? ` (${olay.sebep})` : ''}`);
      return;

    case 'limitBekleniyor':
      is.kalanSn = olay.kalanSn;
      guncelle({ is });
      return;

    case 'kullaniciGerekli':
      is.mesaj = olay.mesaj;
      guncelle({ is });
      kayitEkle(`sizi bekliyor: ${olay.mesaj}`);
      return;

    case 'hata':
      kayitEkle(`hata: ${olay.mesaj}`);
      guncelle({ hata: olay.mesaj });
      return;

    case 'bitti':
      is.ozet = olay.ozet;
      guncelle({ is });
      kayitEkle(
        `bitti — ✓ ${olay.ozet.basarili}, atlanan ${olay.ozet.atlanan}, ✗ ${olay.ozet.basarisiz}`,
      );
      await projeleriYukle();
      if (durum.aktifProje !== null) await galeriyiYukle(durum.aktifProje.id);
      return;

    default:
      return;
  }
}
```

- [ ] **Step 4: `web/js/projeler.js` — proje seçildiğinde galeriyi yükle**

`projeSec` içinde başarılı `api.proje(id)` çağrısından sonra ekle (import: `import { galeriyiYukle } from './galeri.js';`):

```js
    const proje = await api.proje(id);
    // Satırlar liste.js'in düzenlediği tek kaynağa kopyalanır
    guncelle({
      aktifProje: proje,
      satirlar: proje.satirlar.map((s) => ({ ...s })),
      satirGecerli: true,
      hata: null,
    });
    await galeriyiYukle(id);
```

`id === null` dalında da `await galeriyiYukle(null);` çağır.

- [ ] **Step 5: `web/js/uygulama.js`'i tamamla**

```js
import { akisiBaslat } from './akis.js';
import { galeriyiCiz } from './galeri.js';
import { ilerlemeyiBagla, ilerlemeyiCiz } from './ilerleme.js';
```

`baslat()` içinde abonelikleri ve bağlamayı tamamla:

```js
  abone(projeleriCiz);
  abone(listeyiCiz);
  abone(editoruCiz);
  abone(galeriyiCiz);
  abone(ilerlemeyiCiz);

  editoruBagla();
  listeyiBagla();
  ilerlemeyiBagla();

  await projeleriYukle();
  await yonlendir();
  akisiBaslat();

  projeleriCiz();
  ilerlemeyiCiz();
```

`btnKlasor` düğmesini de bağla:

```js
  $('btnKlasor').addEventListener('click', async () => {
    if (durum.aktifProje !== null) await api.klasoruAc(durum.aktifProje.id);
  });
```

(`api` ve `durum` importlarını ekle.)

- [ ] **Step 6: Tarayıcıda doğrula (gerçek ChatGPT olmadan)**

- Sayfa açılışında "Henüz çalıştırılmadı" görünüyor, Başlat pasif ve ipucu "Önce tarayıcıyı açıp…" diyor
- "Tarayıcıyı aç" → Chromium açılıyor, buton "✓ Tarayıcı açık" oluyor, Başlat aktifleşiyor
- Konsolda SSE bağlantısı 200, 401 yok
- Galeri: çıktı klasörüne elle bir PNG koy, sayfayı yenile → görsel ızgarada çıkıyor
- "Klasörü aç" → dosya yöneticisi açılıyor

- [ ] **Step 7: Testleri koştur**

Run: `yarn test && yarn typecheck`
Expected: PASS

---

### Task 10: Silme diyaloğu

**Files:**
- Modify: `web/index.html` (diyalog markup), `web/css/stil.css` (diyalog stili)
- Create: `web/js/silme.js`
- Modify: `web/js/uygulama.js`

**Interfaces:**
- Consumes: `api` (`./api.js`), `durum` (`./durum.js`), `projeler.js`'in yaydığı `proje-sil-istegi` özel olayı (Task 6'da eklendi), `projeleriYukle`/`projeSec`
- Produces: `silmeyiBagla()`

- [ ] **Step 1: `web/index.html`'e diyalogu ekle**

`</body>` öncesine, `<script>` satırının üstüne:

```html
<dialog id="silDiyalogu">
  <h2 id="silBaslik">Projeyi sil?</h2>
  <p id="silKlasor" class="kod soluk"></p>
  <p id="silSayi"></p>
  <label class="onay">
    <input type="checkbox" id="silGorseller" checked>
    Görselleri de sil
  </label>
  <p class="uyari-metin">Bu işlem geri alınamaz.</p>
  <div class="diyalog-butonlar">
    <button id="silVazgec">Vazgeç</button>
    <button id="silOnayla" class="tehlike">Sil</button>
  </div>
</dialog>
```

- [ ] **Step 2: `web/css/stil.css` sonuna diyalog stilini ekle**

```css
dialog {
  border: 1px solid var(--kenar); border-radius: 12px; padding: 18px 20px;
  background: var(--kart); color: var(--metin); max-width: 460px;
  box-shadow: 0 12px 32px rgba(0,0,0,.28);
}
dialog::backdrop { background: rgba(0,0,0,.42); }
dialog h2 { font-size: 15px; text-transform: none; letter-spacing: 0; color: var(--metin); }
dialog .kod { font-family: ui-monospace, Menlo, monospace; font-size: 12px; word-break: break-all; }
dialog .onay { display: flex; align-items: center; gap: 7px; margin: 12px 0; font-size: 14px; }
dialog .onay input { width: auto; }
.diyalog-butonlar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
button.tehlike { background: var(--hata); border-color: var(--hata); color: #fff; }
```

- [ ] **Step 3: `web/js/silme.js` yaz**

```js
import { api } from './api.js';
import { durum } from './durum.js';
import { kayitEkle } from './ilerleme.js';
import { projeSec, projeleriYukle } from './projeler.js';

const $ = (id) => document.getElementById(id);

let hedef = null;

function boyutMetni(bayt) {
  if (bayt < 1024) return `${bayt} B`;
  if (bayt < 1024 * 1024) return `${(bayt / 1024).toFixed(1)} KB`;
  return `${(bayt / (1024 * 1024)).toFixed(1)} MB`;
}

async function diyaloguAc(ozet) {
  hedef = ozet;

  // Sayı ve boyut sunucudan gelir, istemci tahmini değil
  let galeri = { dosyalar: [], toplamBayt: 0 };
  try {
    galeri = await api.galeri(ozet.id);
  } catch {
    // klasör okunamadıysa 0 göster; silme yine denenir
  }

  $('silBaslik').textContent = `"${ozet.ad}" projesini sil?`;
  $('silKlasor').textContent = ozet.ciktiKlasoru;
  $('silSayi').textContent =
    `${galeri.dosyalar.length} görsel (${boyutMetni(galeri.toplamBayt)})`;
  $('silGorseller').checked = true;
  $('silDiyalogu').showModal();
}

async function onayla() {
  if (hedef === null) return;
  const gorselleriSil = $('silGorseller').checked;
  const silinen = hedef;
  hedef = null;
  $('silDiyalogu').close();

  try {
    const sonuc = await api.projeSil(silinen.id, gorselleriSil);

    if (sonuc.korumaliKlasor) {
      kayitEkle(
        `"${silinen.ad}" kaydı silindi. Çıktı klasörü tek bir projeye ait görünmediği için ` +
        `görseller silinmedi — elle silin: ${silinen.ciktiKlasoru}`,
      );
    } else if (sonuc.silinemeyen.length > 0) {
      kayitEkle(
        `"${silinen.ad}" silindi. ${sonuc.silinen} görsel silindi, ` +
        `${sonuc.silinemeyen.length} dosya silinemedi: ${sonuc.silinemeyen.join(', ')}`,
      );
    } else {
      kayitEkle(`"${silinen.ad}" silindi (${sonuc.silinen} görsel).`);
    }
  } catch (hata) {
    kayitEkle(`silinemedi: ${hata.message}`);
    return;
  }

  await projeleriYukle();
  // Silinen proje açıksa: ilk projeye düş, hiç proje kalmadıysa boş duruma
  if (durum.aktifProje !== null && durum.aktifProje.id === silinen.id) {
    location.hash = '';
    const ilk = durum.projeler[0];
    await projeSec(ilk ? ilk.id : null);
  }
}

export function silmeyiBagla() {
  document.addEventListener('proje-sil-istegi', (olay) => void diyaloguAc(olay.detail));
  $('silOnayla').addEventListener('click', () => void onayla());
  $('silVazgec').addEventListener('click', () => {
    hedef = null;
    $('silDiyalogu').close();
  });
}
```

- [ ] **Step 4: `web/js/uygulama.js`'e bağla**

```js
import { silmeyiBagla } from './silme.js';
```

`baslat()` içinde diğer bağlamalarla birlikte `silmeyiBagla();` çağır.

- [ ] **Step 5: Tarayıcıda doğrula**

Test verisi kur:

```bash
mkdir -p /tmp/gu-cikti/silinecek && \
  printf 'x' > /tmp/gu-cikti/silinecek/a.png && \
  printf 'x' > /tmp/gu-cikti/silinecek/b.png && \
  printf 'not' > /tmp/gu-cikti/silinecek/notlar.txt
```

Bir proje oluşturup çıktı klasörünü `/tmp/gu-cikti/silinecek` yap, sonra:

- Proje satırında `×` → diyalog açılıyor, yol ve "2 görsel (2 B)" doğru, kutu işaretli
- Vazgeç → hiçbir şey silinmemiş
- Sil → proje listeden gidiyor; `ls /tmp/gu-cikti/silinecek` → yalnızca `notlar.txt` kalmış, klasör silinmemiş (içi dolu)
- Kutuyu kaldırıp başka bir projeyi sil → PNG'ler yerinde kalıyor
- Açık projeyi sil → ilk projeye düşüyor; son projeyi sil → boş durum ekranı geliyor
- Çalışan bir projeyi silmeye çalış → kayıtta 409 mesajı ("bu proje çalışıyor; önce durdurun")

- [ ] **Step 6: Testleri koştur**

Run: `yarn test && yarn typecheck`
Expected: PASS

---

### Task 11: Uçtan uca canlı doğrulama ve README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README'yi yeni akışa göre güncelle**

Değişecek bölümler:
- `## Yapılandırma` bölümündeki `config.json` / `liste.csv` tablosunu kaldır — artık dosya değil UI var. Yerine "Projeler" bölümü: proje oluşturma, base prompt, satır tablosu/CSV modu, ayarlar, çıktı klasörü.
- `## Çalıştırma`: `yarn baslat` → tarayıcıda UI açılır; `1 · Tarayıcıyı aç` → ChatGPT girişi → `2 · Başlat`.
- Yeni bölüm `## Veriler nerede`: `~/.chatgpt-gorsel-uretici/projeler/<id>.json`, `chrome_profil/`, `~/ChatGPT-Gorseller/<slug>/`.
- Yeni bölüm `## Proje silme`: görsellerin de silindiği, yalnızca doğrudan içindeki `.png` dosyalarının silindiği, alt klasör ve diğer dosyaların korunduğu.
- `## Devam (Resume)` bölümüne ekle: iki proje aynı çıktı klasörünü kullanamaz, sebebi devam mantığı.
- Ortam değişkenleri: `GORSEL_VERI_KOKU`, `GORSEL_CIKTI_KOKU`, `PORT`.

- [ ] **Step 2: Faz 2A'nın canlı doğrulama listesini tekrar koştur**

Tek dosya HTML'den modüllere geçişte davranış kaybı olmadığını kanıtlar.

```bash
GORSEL_VERI_KOKU=/tmp/gu-son GORSEL_CIKTI_KOKU=/tmp/gu-son-cikti yarn baslat
```

Doğrula:
- `GET /` 200, tokensiz istek 401, yabancı `Origin` 401
- `/js/*.js` ve `/css/stil.css` çerezle 200
- `/favicon.ico` 204, konsol temiz
- SSE ilk olayı `durum` geliyor
- Önizleme canlı çalışıyor; `{VARYASYON}` silinince uyarı + kırmızı; Başlat iş başlatmayı 400 ile reddediyor

- [ ] **Step 3: Göçü gerçek veriyle doğrula**

```bash
mkdir -p /tmp/gu-goc && cp config.ornek.json /tmp/gu-goc/proje.json
```

`proje.json`'u elle düzenle: `ad`, `basePrompt`, `ciktiKlasoru`, `satirlar` alanları olsun. Sonra:

```bash
GORSEL_VERI_KOKU=/tmp/gu-goc GORSEL_CIKTI_KOKU=/tmp/gu-goc-cikti yarn baslat
```

Doğrula: solda o proje görünüyor, `/tmp/gu-goc/projeler/<id>.json` oluşmuş, `/tmp/gu-goc/proje.json.tasindi` duruyor, `proje.json` yok.

- [ ] **Step 4: Gerçek ChatGPT ile iki proje testi**

Bu adım gerçek hesap gerektirir; kullanıcı ile birlikte koşulur.

- İki proje oluştur, ikisine 2 satır yaz
- Birinci projede Başlat → görseller galeriye düşüyor
- İş sürerken ikinci projeye geç → üst şerit duruyor, "Projeye git" çalışıyor, ikinci projede Başlat pasif ve ipucu "Bir iş zaten çalışıyor"
- Çalışan projeye dön → alanlar salt-okunur, kilit uyarısı görünüyor
- Duraklat / Devam / Durdur çalışıyor
- İş bitince şerit kayboluyor, özet kayıtta

- [ ] **Step 5: Son kontrol**

Run: `yarn test && yarn typecheck`
Expected: PASS, ≈237 test

Run: `grep -rn "config.json\|liste.csv" README.md src/`
Expected: yalnızca `config.ornek.json` / `liste.ornek.csv` dosya adlarına atıf varsa onlar da kaldırılmış olmalı — çıktı boş

---

## Uygulama sonrası

Kalan işler (bu planın kapsamı dışında, spec §1'de kapsam dışı olarak listelendi): iş geçmişi kaydı, base prompt ekleri, seçici onarım ekranı, iş kuyruğu.

`config.ornek.json` ve `liste.ornek.csv` artık kullanılmıyor. Silinmeleri kullanıcı onayına bırakılır — plan bunları silmez.
