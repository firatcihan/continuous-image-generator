# Script'ten satır üretme — uygulama planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zaman damgalı script'i yapıştırıp satır listesine çevirmek — her satırın dosya adı, metin parçasını bitiren zaman damgası.

**Architecture:** Ayrıştırma yerel ve sunucuda (`src/script.ts`), CSV ayrıştırıcıyla aynı desende: tek rota (`POST /api/script/ayristir`), tarayıcıda ikinci kopya yok. Script projeye `script` alanı olarak kaydedilir, satırlar yalnızca "Satırlara çevir" ile değişir. ChatGPT bu akışta hiç devrede değil.

**Tech Stack:** TypeScript (ESM, `.js` uzantılı import), Fastify 5, vitest, tarayıcıda düz ES modülleri (derleyici yok).

## Global Constraints

- Kod, değişken, işlev ve dosya adları Türkçe — mevcut desen (`satirlariAyristir`, `projeDogrula`).
- Import'lar ESM: `./liste.js` (kaynak `.ts` olsa da uzantı `.js`).
- Yorumlar NEDEN'i anlatır, NE'yi değil; mevcut dosyalardaki ton korunur.
- Zaman damgası biçimi: `(0:09)` `[0:09]` `(1:02:33)` `[12:05]`. Çıplak `9:30` **tanınmaz**.
- Adlandırma: damga **i**'den önceki parça damga **i** ile adlanır; son parça `<son damga>_son`.
- Tekrar eden damga: ikinci `_2`, üçüncü `_3`.
- Segment içi boşluk dizileri (satır sonu dahil) tek boşluğa iner, uçlar kırpılır.
- Hata mesajları Türkçe, kullanıcıya gösterilecek metin: `'Script içinde (0:00) biçiminde zaman damgası bulunamadı'`, `'Script içinde çevrilecek metin yok'`, `'icerik metni gerekli'`.
- Commit'ler kullanıcı onayı ile atılır (proje kuralı) — plandaki commit adımları onay sonrası çalıştırılır.

Spec: `docs/superpowers/specs/2026-08-13-scriptten-satir-uretme-design.md`

## Dosya haritası

| Dosya | Sorumluluk |
|---|---|
| `src/script.ts` (yeni) | Script metni → `Satir[]`. Tek dışa açık işlev. |
| `tests/script.test.ts` (yeni) | Ayrıştırıcı birim testleri. |
| `src/depo/projeler.ts` (değişir) | `Proje.script` alanı + doğrulama. |
| `tests/projeler.test.ts` (değişir) | `script` alanı kaydı ve eski dosya varsayılanı. |
| `src/sunucu/index.ts` (değişir) | `POST /api/script/ayristir`. |
| `tests/sunucu-script.test.ts` (yeni) | Rota testleri (200/400/401). |
| `web/index.html` (değişir) | Mod düğmeleri, script textarea, çevir düğmesi, onay diyaloğu. |
| `web/css/stil.css` (değişir) | Mod anahtarı görünümü. |
| `web/js/api.js` (değişir) | `scriptAyristir(icerik)`. |
| `web/js/editor.js` (değişir) | `script` alanını forma/projeye taşı. |
| `web/js/liste.js` (değişir) | `mod` durumu, çevirme akışı, onay diyaloğu. |

---

### Task 1: Ayrıştırıcı

**Files:**
- Create: `src/script.ts`
- Test: `tests/script.test.ts`

**Interfaces:**
- Consumes: `dosyaAdiTemizle(ad: string): string` (`src/liste.ts`), `Satir { metin: string; dosyaAdi: string }` (`src/tipler.ts`)
- Produces: `scriptiSatirlaraCevir(icerik: string): Satir[]` — damga yoksa veya hiç metin yoksa `Error` fırlatır

- [ ] **Step 1: Write the failing test**

`tests/script.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { scriptiSatirlaraCevir } from '../src/script.js';

const ORNEK = '(0:00) Bugün hava durumundan bahsedeceğiz. Öğleden (0:09) sonra sıcaklık'
  + ' yükseldi.\nŞimdi teknoloji, (0:17) yapay zeka araçları. Son olarak (0:23) spordan'
  + ' bahsedelim.';

describe('scriptiSatirlaraCevir', () => {
  it('parçayı BİTİREN damgayla adlandırır, son parçaya _son ekler', () => {
    expect(scriptiSatirlaraCevir(ORNEK)).toEqual([
      { metin: 'Bugün hava durumundan bahsedeceğiz. Öğleden', dosyaAdi: '0_09' },
      { metin: 'sonra sıcaklık yükseldi. Şimdi teknoloji,', dosyaAdi: '0_17' },
      { metin: 'yapay zeka araçları. Son olarak', dosyaAdi: '0_23' },
      { metin: 'spordan bahsedelim.', dosyaAdi: '0_23_son' },
    ]);
  });

  it('köşeli parantez ve saat basamağını tanır', () => {
    expect(scriptiSatirlaraCevir('a [0:09] b (1:02:33) c')).toEqual([
      { metin: 'a', dosyaAdi: '0_09' },
      { metin: 'b', dosyaAdi: '1_02_33' },
      { metin: 'c', dosyaAdi: '1_02_33_son' },
    ]);
  });

  it('çıplak saat ifadesini bölme noktası saymaz', () => {
    expect(scriptiSatirlaraCevir('saat 9:30\'da buluştuk (0:09) sonrası')).toEqual([
      { metin: 'saat 9:30\'da buluştuk', dosyaAdi: '0_09' },
      { metin: 'sonrası', dosyaAdi: '0_09_son' },
    ]);
  });

  it('boş segmenti atlar', () => {
    expect(scriptiSatirlaraCevir('(0:00) (0:09) metin')).toEqual([
      { metin: 'metin', dosyaAdi: '0_09_son' },
    ]);
  });

  it('tekrar eden damgada ikinci adı _2 yapar', () => {
    expect(scriptiSatirlaraCevir('a (0:09) b (0:09) c')).toEqual([
      { metin: 'a', dosyaAdi: '0_09' },
      { metin: 'b', dosyaAdi: '0_09_2' },
      { metin: 'c', dosyaAdi: '0_09_son' },
    ]);
  });

  it('satır sonlarını ve çoklu boşlukları tek boşluğa indirir', () => {
    expect(scriptiSatirlaraCevir('  ilk\n\nsatır   ikinci  (0:09) son ')).toEqual([
      { metin: 'ilk satır ikinci', dosyaAdi: '0_09' },
      { metin: 'son', dosyaAdi: '0_09_son' },
    ]);
  });

  it('damga yoksa hata verir', () => {
    expect(() => scriptiSatirlaraCevir('damgasız metin')).toThrow(/zaman damgası bulunamadı/);
  });

  it('damga var ama metin yoksa hata verir', () => {
    expect(() => scriptiSatirlaraCevir('(0:00) (0:09)  ')).toThrow(/çevrilecek metin yok/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run tests/script.test.ts`
Expected: FAIL — `Failed to resolve import "../src/script.js"`

- [ ] **Step 3: Write minimal implementation**

`src/script.ts`:

```ts
import { dosyaAdiTemizle } from './liste.js';
import type { Satir } from './tipler.js';

/**
 * Yalnızca parantez ya da köşeli parantez içindeki damga. Çıplak `9:30`
 * KASITLA dışarıda: konuşma metninde geçen "saat 9:30'da" scripti yanlış
 * yerden bölerdi.
 */
const DAMGA = /[(\[]\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[)\]]/g;

/**
 * Zaman damgalı script'i satırlara çevirir. Damga **i**'den ÖNCEKİ parça damga
 * **i** ile adlanır — kullanıcı görselin videoda hangi ana kadar süreceğini
 * dosya adından okuyor. Son damgadan sonraki parçayı bitiren bir damga yok;
 * `_son` eki hem onu adlandırır hem de aynı damgayla çakışmasını önler.
 */
export function scriptiSatirlaraCevir(icerik: string): Satir[] {
  const damgalar = [...icerik.matchAll(DAMGA)].map((eslesme) => ({
    deger: eslesme[1],
    bas: eslesme.index ?? 0,
    son: (eslesme.index ?? 0) + eslesme[0].length,
  }));
  if (damgalar.length === 0) {
    throw new Error('Script içinde (0:00) biçiminde zaman damgası bulunamadı');
  }

  const parcalar: { metin: string; ad: string }[] = [];
  let imlec = 0;
  for (const damga of damgalar) {
    parcalar.push({ metin: icerik.slice(imlec, damga.bas), ad: damga.deger });
    imlec = damga.son;
  }
  const sonDamga = damgalar[damgalar.length - 1].deger;
  parcalar.push({ metin: icerik.slice(imlec), ad: `${sonDamga}_son` });

  const satirlar: Satir[] = [];
  const gorulen = new Map<string, number>();
  for (const parca of parcalar) {
    const metin = bosluklariSikistir(parca.metin);
    if (metin === '') continue; // iki ardışık damga arası boş — satır üretmez
    satirlar.push({ metin, dosyaAdi: tekilAd(dosyaAdiTemizle(parca.ad), gorulen) });
  }
  if (satirlar.length === 0) throw new Error('Script içinde çevrilecek metin yok');
  return satirlar;
}

/** Metin `{VARYASYON}` yerine geçip prompt kutusuna yazılıyor; satır sonunun orada anlamı yok. */
function bosluklariSikistir(metin: string): string {
  return metin.replace(/\s+/g, ' ').trim();
}

/**
 * Aynı damga iki kez geçerse ikinci ad `_2` olur. Tekrar eden dosya adı
 * kaydı 400'e düşürürdü; kullanıcı da hangi satırı elle değiştireceğini
 * bilemezdi.
 */
function tekilAd(ad: string, gorulen: Map<string, number>): string {
  const adet = (gorulen.get(ad) ?? 0) + 1;
  gorulen.set(ad, adet);
  return adet === 1 ? ad : `${ad}_${adet}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run tests/script.test.ts` → 8 test PASS
Run: `yarn typecheck` → hata yok

- [ ] **Step 5: Commit** (kullanıcı onayı ile)

```bash
git add src/script.ts tests/script.test.ts
git commit -m "feat: zaman damgalı script'i satırlara çeviren ayrıştırıcı"
```

---

### Task 2: Projede script alanı

**Files:**
- Modify: `src/depo/projeler.ts` (`Proje` arayüzü ~25-34, `yeniProje` ~67-78, `projeDogrula` dönüşü ~94-104)
- Test: `tests/projeler.test.ts`

**Interfaces:**
- Produces: `Proje.script: string` — varsayılan `''`; `projeDogrula` alanı `metinAlan(kaynak.script, '')` ile okur, bu yüzden eski proje dosyaları için ayrı göç kodu gerekmez

- [ ] **Step 1: Write the failing test**

`tests/projeler.test.ts` sonuna ekle (dosyanın mevcut `describe` bloklarıyla aynı düzeyde):

```ts
describe('script alanı', () => {
  it('yazılıp okunur', () => {
    const depo = new ProjelerDepo(kok, join(kok, 'cikti'));
    const proje = depo.olustur('Kedi');
    expect(proje.script).toBe('');

    depo.yaz({ ...proje, script: '(0:00) merhaba (0:09) dünya' });
    expect(depo.oku(proje.id)?.script).toBe('(0:00) merhaba (0:09) dünya');
  });

  it('script alanı olmayan eski dosyayı boş string ile okur', () => {
    const depo = new ProjelerDepo(kok, join(kok, 'cikti'));
    const proje = depo.olustur('Kedi');

    const yol = join(kok, 'projeler', `${proje.id}.json`);
    const ham = JSON.parse(readFileSync(yol, 'utf-8'));
    delete ham.script;
    writeFileSync(yol, JSON.stringify(ham), 'utf-8');

    expect(depo.oku(proje.id)?.script).toBe('');
  });
});
```

Not: `tests/projeler.test.ts` başındaki import'larda `readFileSync`/`writeFileSync` yoksa `node:fs` satırına ekle; `kok` değişkeni mevcut `beforeEach`'ten gelir. Dosyanın mevcut kurulumu farklıysa (ör. depo zaten `beforeEach`'te kuruluyorsa) yerel `new ProjelerDepo(...)` satırlarını sil ve mevcut değişkeni kullan.

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run tests/projeler.test.ts`
Expected: FAIL — `expected undefined to be ''`

- [ ] **Step 3: Write minimal implementation**

`src/depo/projeler.ts` — `Proje` arayüzüne alan ekle:

```ts
export interface Proje {
  id: string;
  ad: string;
  basePrompt: string;
  ciktiKlasoru: string;
  satirlar: Satir[];
  /** Satırların üretildiği zaman damgalı ham script; üretime girmez, düzenlenebilir kalsın diye saklanır. */
  script: string;
  ayarlar: Ayarlar;
  olusturmaTarihi: string;
  guncellemeTarihi: string;
}
```

`yeniProje` dönüşüne `satirlar: []` satırından sonra:

```ts
    script: '',
```

`projeDogrula` dönüşüne `satirlar: satirlariDogrula(kaynak.satirlar),` satırından sonra:

```ts
    // Eski proje dosyalarında bu alan yok; `metinAlan` varsayılanı göç yerine geçer.
    script: metinAlan(kaynak.script, ''),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run tests/projeler.test.ts` → PASS
Run: `yarn test` → tüm süit PASS (`yeniProje`/`projeDogrula` beklenen nesnesini `toEqual` ile karşılaştıran testler varsa `script: ''` eklenmesi gerekir)
Run: `yarn typecheck` → hata yok

- [ ] **Step 5: Commit** (kullanıcı onayı ile)

```bash
git add src/depo/projeler.ts tests/projeler.test.ts
git commit -m "feat: projeye script alanı"
```

---

### Task 3: Ayrıştırma rotası

**Files:**
- Modify: `src/sunucu/index.ts` (import bloğu ~8, `POST /api/csv/ayristir`'dan sonra ~333)
- Test: `tests/sunucu-script.test.ts`

**Interfaces:**
- Consumes: `scriptiSatirlaraCevir` (Task 1)
- Produces: `POST /api/script/ayristir` — istek `{ icerik: string }`, yanıt `200 { satirlar: Satir[] }` veya `400 { hata: string }`

- [ ] **Step 1: Write the failing test**

`tests/sunucu-script.test.ts`:

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
  kok = mkdtempSync(join(tmpdir(), 'sunucu-script-'));
  const web = join(kok, 'web');
  mkdirSync(web, { recursive: true });
  writeFileSync(join(web, 'index.html'), '<h1>merhaba</h1>', 'utf-8');

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

const yetkili = () => ({ 'x-token': TOKEN, origin: ORIGIN });

describe('POST /api/script/ayristir', () => {
  it('script\'i satırlara çevirir', async () => {
    const y = await uygulama.inject({
      method: 'POST', url: '/api/script/ayristir', headers: yetkili(),
      payload: { icerik: '(0:00) ilk (0:09) son' },
    });
    expect(y.statusCode).toBe(200);
    expect(y.json()).toEqual({
      satirlar: [
        { metin: 'ilk', dosyaAdi: '0_09' },
        { metin: 'son', dosyaAdi: '0_09_son' },
      ],
    });
  });

  it('icerik metin değilse 400 döner', async () => {
    const y = await uygulama.inject({
      method: 'POST', url: '/api/script/ayristir', headers: yetkili(),
      payload: { icerik: 42 },
    });
    expect(y.statusCode).toBe(400);
    expect(y.json().hata).toBe('icerik metni gerekli');
  });

  it('damga yoksa ayrıştırıcının mesajıyla 400 döner', async () => {
    const y = await uygulama.inject({
      method: 'POST', url: '/api/script/ayristir', headers: yetkili(),
      payload: { icerik: 'damgasız' },
    });
    expect(y.statusCode).toBe(400);
    expect(y.json().hata).toMatch(/zaman damgası bulunamadı/);
  });

  it('token yoksa 401 döner', async () => {
    const y = await uygulama.inject({
      method: 'POST', url: '/api/script/ayristir',
      payload: { icerik: '(0:00) a (0:09) b' },
    });
    expect(y.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run tests/sunucu-script.test.ts`
Expected: FAIL — ilk testte `404` (rota yok)

- [ ] **Step 3: Write minimal implementation**

`src/sunucu/index.ts` import bloğuna (`satirlariAyristir` satırının yanına):

```ts
import { scriptiSatirlaraCevir } from '../script.js';
```

`POST /api/csv/ayristir` bloğundan hemen sonra:

```ts
  // Script ayrıştırma da sunucuda: CSV'yle aynı gerekçe — tarayıcıdaki ikinci
  // bir kopya zamanla ayrışır ve kullanıcının script'i tarayıcıda geçip
  // sunucuda reddedilirdi.
  uygulama.post('/api/script/ayristir', async (istek, yanit) => {
    const govde = (istek.body ?? {}) as { icerik?: unknown };
    if (typeof govde.icerik !== 'string') {
      return yanit.code(400).send({ hata: 'icerik metni gerekli' });
    }
    try {
      return { satirlar: scriptiSatirlaraCevir(govde.icerik) };
    } catch (hata) {
      return yanit.code(400).send({ hata: (hata as Error).message });
    }
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run tests/sunucu-script.test.ts` → 4 test PASS
Run: `yarn typecheck` → hata yok

- [ ] **Step 5: Commit** (kullanıcı onayı ile)

```bash
git add src/sunucu/index.ts tests/sunucu-script.test.ts
git commit -m "feat: POST /api/script/ayristir rotası"
```

---

### Task 4: UI — üçüncü mod ve çevirme

**Files:**
- Modify: `web/index.html` (Satırlar `section`'ı ~56-64; yeni diyalog `silDiyalogu`'nun yanına ~121)
- Modify: `web/css/stil.css` (`button.kucuk` kuralının yanı ~148)
- Modify: `web/js/api.js` (`csvAyristir`'ın yanı ~55)
- Modify: `web/js/editor.js` (`formdanProje` ~19-38, `editoruCiz` ~133-138)
- Modify: `web/js/liste.js` (tamamı: `csvModu` → `mod`)

**Interfaces:**
- Consumes: `POST /api/script/ayristir` (Task 3), `Proje.script` (Task 2)
- Produces: DOM sözleşmesi — `#btnModTablo` `#btnModCsv` `#btnModScript` `#scriptAlani` `#btnCevir` `#cevirDiyalogu` `#cevirMesaj` `#cevirVazgec` `#cevirOnayla`

- [ ] **Step 1: HTML — mod düğmeleri, script alanı, diyalog**

`web/index.html` Satırlar `section`'ını şununla değiştir:

```html
      <section>
        <h2>Satırlar <span id="satirSayisi" class="soluk"></span>
          <span class="mod-anahtari">
            <button id="btnModTablo" class="kucuk">Tablo</button>
            <button id="btnModCsv" class="kucuk">CSV</button>
            <button id="btnModScript" class="kucuk">Script</button>
          </span>
        </h2>
        <div id="tabloKabi"></div>
        <textarea id="csvAlani" class="kod" rows="10" hidden></textarea>
        <textarea id="scriptAlani" class="kod" rows="10" hidden
          placeholder="(0:00) Bugün hava durumundan bahsedeceğiz. Öğleden (0:09) sonra sıcaklık yükseldi."></textarea>
        <p class="uyari-metin" id="satirUyari" hidden></p>
        <button id="btnSatirEkle">Satır ekle</button>
        <button id="btnCevir" class="birincil" hidden>Satırlara çevir</button>
      </section>
```

`#silDiyalogu`'nun hemen ardına (gövde dışında — çalışan projede `#btnCevir` sönük olduğu için diyalog hiç açılmaz):

```html
<dialog id="cevirDiyalogu">
  <h2>Satırların üzerine yazılsın mı?</h2>
  <p id="cevirMesaj"></p>
  <div class="diyalog-butonlar">
    <button id="cevirVazgec">Vazgeç</button>
    <button id="cevirOnayla" class="birincil">Devam</button>
  </div>
</dialog>
```

- [ ] **Step 2: CSS — mod anahtarı**

`web/css/stil.css`, `button.kucuk` kuralının altına:

```css
.mod-anahtari { float: right; display: inline-flex; gap: 4px; }
.mod-anahtari button { float: none; }
.mod-anahtari button.aktif {
  background: color-mix(in srgb, var(--vurgu) 16%, transparent);
  border-color: var(--vurgu); color: var(--vurgu);
}
```

- [ ] **Step 3: api.js — yeni çağrı**

`web/js/api.js`, `csvAyristir`'ın hemen ardına:

```js
  scriptAyristir: (icerik) =>
    istek('/api/script/ayristir', { method: 'POST', body: JSON.stringify({ icerik }) }),
```

- [ ] **Step 4: editor.js — script alanını taşı**

`formdanProje` dönüşünde `basePrompt` satırının ardına:

```js
    script: $('scriptAlani').value,
```

`editoruCiz` içindeki `if (cizilenProjeId !== proje.id) {` bloğunda `$('basePrompt').value = proje.basePrompt;` satırının ardına:

```js
    $('scriptAlani').value = proje.script;
```

- [ ] **Step 5: liste.js — mod durumu ve çevirme akışı**

`csvModu` boolean'ını üç değerli `mod` ile değiştir ve çevirmeyi ekle. Değişen/eklenen bloklar:

```js
/** 'tablo' | 'csv' | 'script' — hangi düzenleyici açık. */
let mod = 'tablo';
```

`listeyiCiz` içindeki `csvModu = false;` satırı → `mod = 'tablo';`

`modKabuguCiz` yerine:

```js
function modKabuguCiz() {
  $('tabloKabi').hidden = mod !== 'tablo';
  $('csvAlani').hidden = mod !== 'csv';
  $('scriptAlani').hidden = mod !== 'script';
  $('btnSatirEkle').hidden = mod !== 'tablo';
  $('btnCevir').hidden = mod !== 'script';

  for (const [dugme, deger] of [
    ['btnModTablo', 'tablo'], ['btnModCsv', 'csv'], ['btnModScript', 'script'],
  ]) {
    $(dugme).classList.toggle('aktif', mod === deger);
  }
  $('satirSayisi').textContent = `(${satirlar().length})`;
}
```

`bildir()` içindeki `if (csvModu) {` → `if (mod === 'csv') {`

`listeyiBagla` içindeki `btnCsvModu` dinleyicisi yerine mod düğmeleri ve çevir düğmesi:

```js
  /**
   * Mod değiştirir. CSV'den çıkarken ayrıştırma başarısızsa mod DEĞİŞMEZ:
   * geçersiz CSV'yi bırakıp gitmek kullanıcının yazdığı satırları kaybettirir.
   */
  async function moduDegistir(hedef) {
    if (hedef === mod) return;

    if (mod === 'csv') {
      const sonuc = await csvdenTazele();
      if (sonuc.durum === 'eski') return;
      if (sonuc.durum === 'hata') {
        $('satirUyari').hidden = false;
        $('satirUyari').textContent =
          `CSV geçersiz — moddan çıkmadan önce düzeltin (${sonuc.mesaj})`;
        return;
      }
    }

    mod = hedef;
    if (mod === 'csv') $('csvAlani').value = csveCevir(satirlar());
    if (mod === 'tablo') tabloyuCiz();
    modKabuguCiz();
    void bildir();
  }

  $('btnModTablo').addEventListener('click', () => void moduDegistir('tablo'));
  $('btnModCsv').addEventListener('click', () => void moduDegistir('csv'));
  $('btnModScript').addEventListener('click', () => void moduDegistir('script'));

  $('btnCevir').addEventListener('click', () => void cevir());

  $('csvAlani').addEventListener('input', () => void bildir());
  // Script alanı satırlara DOKUNMAZ; yalnızca projeye kaydedilir.
  $('scriptAlani').addEventListener('input', () => void degisiklikBildir());
```

Çevirme akışı (modül düzeyinde, `listeyiBagla`'nın üstüne):

```js
/**
 * Script'i satırlara çevirir. Ayrıştırma sunucuda; hata durumunda mevcut
 * satırlara DOKUNULMAZ — kısmi yazma yok, ya hepsi ya hiçbiri.
 */
async function cevir() {
  const uyari = $('satirUyari');
  let yeni;
  try {
    const sonuc = await api.scriptAyristir($('scriptAlani').value);
    yeni = sonuc.satirlar;
  } catch (hata) {
    uyari.hidden = false;
    uyari.textContent = `Script çevrilemedi — ${hata.message}`;
    return;
  }

  const mevcut = satirlar().length;
  if (mevcut > 0 && !(await onayAl(mevcut, yeni.length))) return;

  uyari.hidden = true;
  uyari.textContent = '';
  satirlariYaz(yeni, true);
  mod = 'tablo';
  tabloyuCiz();
  modKabuguCiz();
  void bildir();
}

/** Dolu listenin üzerine yazmadan önce onay — kaza ile elle girilmiş satır kaybolmasın. */
function onayAl(mevcut, gelen) {
  const diyalog = $('cevirDiyalogu');
  $('cevirMesaj').textContent =
    `${mevcut} satır silinip ${gelen} yeni satırla değiştirilecek.`;

  return new Promise((coz) => {
    const kapat = (sonuc) => {
      diyalog.close();
      $('cevirOnayla').removeEventListener('click', onayla);
      $('cevirVazgec').removeEventListener('click', vazgec);
      coz(sonuc);
    };
    const onayla = () => kapat(true);
    const vazgec = () => kapat(false);

    $('cevirOnayla').addEventListener('click', onayla);
    $('cevirVazgec').addEventListener('click', vazgec);
    diyalog.showModal();
  });
}
```

- [ ] **Step 6: Doğrula — testler ve tip kontrolü**

Run: `yarn test` → tüm süit PASS
Run: `yarn typecheck` → hata yok

- [ ] **Step 7: Commit** (kullanıcı onayı ile)

```bash
git add web/index.html web/css/stil.css web/js/api.js web/js/editor.js web/js/liste.js
git commit -m "feat: Satırlar bölümünde script modu ve satırlara çevirme"
```

---

### Task 5: Uygulamada elle doğrulama

**Files:** (kod değişikliği yok — yalnızca doğrulama; çıkan hata bulunursa ilgili task'a dönülür)

- [ ] **Step 1: Uygulamayı başlat**

Run: `PORT=5599 yarn baslat`
Beklenen: konsolda `http://127.0.0.1:5599/?t=<token>`

- [ ] **Step 2: Script modunu dene**

Bir projede `Script` moduna geç, spec'teki örnek script'i yapıştır, `Satırlara çevir`'e bas.
Beklenen: 4 satır, dosya adları `0_09`, `0_17`, `0_23`, `0_23_son`; mod tabloya döner; gösterge `Kaydedildi`.

- [ ] **Step 3: Üzerine yazma onayını dene**

Dolu listede tekrar `Satırlara çevir` → diyalog "4 satır silinip 4 yeni satırla değiştirilecek."
`Vazgeç` → satırlar aynı kalır. `Devam` → satırlar yenilenir.

- [ ] **Step 4: Hata yolunu dene**

Script alanına damgasız metin yaz → `Satırlara çevir`.
Beklenen: uyarı satırında "zaman damgası bulunamadı", satırlar korunur.

- [ ] **Step 5: Kalıcılığı dene**

Başka projeye geç, geri dön.
Beklenen: script alanı içeriği yerinde.

- [ ] **Step 6: Sunucuyu kapat**

Ctrl-C (arka planda çalıştıysa süreç durdurulur).

---

## Self-review notu

Spec kapsamı taranıp plana eşlendi: ayrıştırma kuralları + kenar durumlar → Task 1; kalıcılık → Task 2; rota → Task 3; UI/mod/onay/kilit → Task 4; doğrulama → Task 5. Kilit için ek kod yok — `stil.css:157` `.kilitli textarea, .kilitli button:not(.serbest)` yeni alan ve düğmeyi zaten kapsıyor. Fonksiyon adları tasklar arası tutarlı: `scriptiSatirlaraCevir`, `scriptAyristir`, `moduDegistir`, `cevir`, `onayAl`.
