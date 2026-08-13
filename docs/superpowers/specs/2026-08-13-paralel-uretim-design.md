# Paralel Üretim — N Sekme — Tasarım Dokümanı

Tarih: 2026-08-13
Durum: onaylandı
Öncesi: [Çok Proje + UI Kabuğu](2026-08-11-cok-proje-ui-design.md) — o spec'in
"kapsam dışı" tablosunda *"İş kuyruğu / paralel iş — çoklu tarayıcı yönetimi
ayrı bir faz"* diye ertelenen iş budur.

## 1. Amaç

Bugün satırlar tek sekmede, tek tek işleniyor. Çalışma kaydından ölçülen
gerçek süre görsel başına **~63 saniye** (`13:21:46` işlenmeye başladı →
`13:22:49` kaydedildi). 200 satırlık bir koşu satır arası beklemelerle
birlikte **~3,5 saat** sürer ve bu sürenin neredeyse tamamı ChatGPT'nin
görseli üretmesini beklemekle geçer — yerel taraf boşta durur.

Bu faz, seçili projenin satırlarını **N eş zamanlı sekmeye** dağıtır. N=3'te
aynı koşu ~1,2 saate iner.

### Ölçüm durumu ve kota belirsizliği

Çalışma kaydında bugüne kadar **11 görsel, 0 rate limit** var — gerçek büyük
koşu hiç yapılmamış. Yani ChatGPT'nin görsel kotasının nerede olduğu
**bilinmiyor**.

Bu belirsizlik tasarımı şekillendiriyor:

- Darboğaz **gecikme** ise (kota bağlayıcı değilse) N sekme ~N kat hızlandırır.
- Darboğaz **kota** ise N sekme toplam hızı artırmaz; kotayı N kat hızlı
  tüketip beklemeye geçer. Zarar vermez ama kazanç da vermez.

Hangisi olduğu ancak ölçülerek anlaşılır. Bu yüzden N **proje ayarıdır** ve
varsayılanı **1**'dir: kimse istemeden hızlanmaz, kullanıcı 2'de ve 3'te kendi
ölçümünü yapar. N=1 aynı zamanda tek kaçış yoludur — ChatGPT paralel
kullanıma tepki verirse ayarı geri çekmek yeter, kod değişmez.

### Kapsam dışı (bilinçli)

| Konu | Sebep |
|---|---|
| Aynı anda birden fazla **proje** çalıştırmak | `IsYoneticisi` tekilliğini ve UI'ın "çalışan iş" modelini kırar. Kota hesap başına olduğu için toplam hız aynı tavana çarpar; karmaşıklık karşılığını vermez |
| N ayrı `BrowserContext` / ayrı Chrome profilleri | `launchPersistentContext` profil klasörünü kilitler → N profil → N ayrı ChatGPT girişi. Kota yine hesap başına, kazanç sıfır |
| Otomatik N ayarlama (kota gözlemleyip N'i düşürme) | Önce kota davranışının ölçülmesi gerekiyor; veri yokken sezgisel yazmak erken |
| Görsel dosyalarının atomik yazımı | Mevcut risk bu fazla artmıyor (§7); ayrı iş |
| İş geçmişi / koşu başına kayıt | Bugün de yok |

## 2. Kararlar ve gerekçeleri

| Karar | Alternatif | Neden bu |
|---|---|---|
| Paylaşılan kuyruk üstünde N bağımsız işçi | Tek döngülü round-robin durum makinesi | "Kuyruk üstünde işçi havuzu" standart eşzamanlılık desenidir; round-robin, event loop'un zaten yaptığı zamanlamayı elle yeniden yazmaktır. Ayrıca `satiriIsle` olduğu gibi korunur — round-robin'de deneme sayacı ve kontroller sekme başına açık duruma çevrilip `worker.ts` baştan yazılırdı |
| N proje ayarı, varsayılan 1 | Kodda sabit 3 | Ölçüm ve geri dönüş imkânı. Varsayılan 1 olduğu için mevcut projelerin davranışı göçte sessizce değişmez |
| Tek `BrowserContext`, N sekme | N context | Profil kilidi + tek oturum (§1 kapsam dışı) |
| "İlk gören yapar, diğerleri bekler" (`TekYurutuc`) | Her işçi kendi başına ele alır | 3 işçi × 15 dk rate-limit uykusu 45 dk'ya serileşirdi; 3 ayrı "giriş yapın" kartı çıkardı; 3 ayrı tarayıcı yeniden başlatması tetiklenirdi |
| Sekme tutamacı slot no tutar, ham `Page` değil | İşçiler yeniden başlatma sonrası `sekmeAc()`'i tekrar çağırır | `yenidenBaslat()` tüm `Page` nesnelerini öldürür; slot dolaylaması sayesinde işçilerin elindeki tutamaç geçerli kalır ve kurtarma yolu işçi tarafında hiç kod istemez |
| `IsDurumu` tek değer kalır | İşçi başına durum | Kapılar global: limit kapısı kapandığında *iş* limit bekliyordur. Tek değer dürüst kalır |
| İlerleme sayacı `biten/toplam` | `sira/toplam` | Üç işçi 5, 6, 7'deyken "sira" tanımsızdır. Biten sayısı her N'de monotonik ve doğru |

## 3. Mimari

### 3.1 Tarayıcı katmanı — context/sekme ayrımı

`UretimTarayicisi` bugün context yaşam döngüsü ile sayfa işlemlerini tek
arayüzde karıştırıyor. İkiye ayrılıyor (`src/tipler.ts`):

```ts
/** Chromium context'i — tüm sekmeler paylaşır. */
export interface UretimTarayicisi {
  baslat(): Promise<void>;
  yenidenBaslat(): Promise<void>;
  /** Sekme sayısını n'e tamamlar, hepsinin tutamacını döndürür. */
  sekmeleriHazirla(n: number): Promise<UretimSekmesi[]>;
  kapat(): Promise<void>;
}

/** Tek sekme — tek bir işçiye ait, paylaşılmaz. */
export interface UretimSekmesi {
  yeniSohbetAc(): Promise<void>;
  oturumAcikMi(): Promise<boolean>;
  aktifModelAdi(): Promise<string>;
  gorselUret(prompt: string, zamanAsimiSn: number): Promise<GorselSonucu>;
  sonGorseliKaydet(hedefYol: string): Promise<void>;
}
```

`src/tarayici.ts` içinde `ChatgptSekmesi` sınıfı doğuyor. Mevcut sayfa
metotlarının **gövdeleri değişmiyor** — hepsi zaten `this.sayfa()` üzerinden
gidiyor, sadece o özel metodun kaynağı değişiyor. README'nin "Playwright'a
dokunan tek modül `src/tarayici.ts`" kuralı korunuyor.

**Sekmeler ne zaman açılır.** Tarayıcı açma ile iş başlatma ayrı adımlar:
"1 · Tarayıcıyı aç" projeden bağımsızdır, N ise proje ayarıdır. Bu yüzden
tarayıcı hep **tek sekmeyle** açılır (giriş sekmesi); N sekme **iş başlarken**
`sekmeleriHazirla(n)` ile tamamlanır. Sekme 0, giriş sekmesi olarak yeniden
kullanılır.

**Yeniden başlatmadan sonra tutamaç geçerliliği.** `ChatgptSekmesi` ham `Page`
tutmaz; ana nesneye referans + slot numarası tutar ve her çağrıda
`ana.sayfaAl(slot)` der. `yenidenBaslat()` context'i kapatır, yenisini açar,
**aynı sayıda** sayfa üretip diziyi doldurur. Slot numaraları geçerli kalır.

### 3.2 İşçi havuzu

`src/worker.ts`:

```ts
export async function tumSatirlariIsle(b: WorkerBagimliliklari, satirlar: Satir[]): Promise<IslemOzeti> {
  const ozet: IslemOzeti = { basarili: 0, atlanan: 0, basarisiz: 0 };
  let imlec = 0;

  // Okuma ile artırma arasında `await` YOK — Node tek iş parçacıklı olduğu için
  // bu atomiktir; iki işçi asla aynı satırı çekemez.
  const siradaki = (): { sira: number; satir: Satir } | null =>
    imlec < satirlar.length ? { sira: ++imlec, satir: satirlar[imlec - 1] } : null;

  await Promise.all(
    b.sekmeler.map((sekme, i) => birIsciCalistir(b, sekme, i, siradaki, ozet, satirlar.length)),
  );
  return ozet;
}
```

`birIsciCalistir`'ın gövdesi bugünkü `for` gövdesinin aynısı; tek fark satır
kaynağı:

```ts
/** Duraklatma + üç koordinasyon kapısı (§3.3). Hepsi aynı yerde geçilir. */
async function kapilariGec(b: WorkerBagimliliklari): Promise<void> {
  await b.kontrol.kapi.gec();            // duraklatma (mevcut)
  await b.kapilar.limit.gec();           // rate limit boşaltması
  await b.kapilar.kullanici.gec();       // kullanıcı müdahalesi
  await b.kapilar.yenidenBaslatma.gec(); // tarayıcı yeniden başlıyor
}

for (;;) {
  if (b.kontrol.signal.aborted) return;
  await kapilariGec(b);
  if (b.kontrol.signal.aborted) return;

  const is = siradaki();
  if (is === null) return;             // kuyruk bitti, işçi kendini çeker
  // … bugünkü gövde (tamamlandiMi / satirBasladi / satiriIsle / satirBitti) …
  await b.uyu(rastgeleSureMs(b.config.satirArasiBekleme), 'satirArasi');
}
```

`satiriIsle` **mantık olarak değişmiyor**; iki isim değişiyor:
`b.tarayici.X` → `sekme.X`, `b.tarayici.yenidenBaslat()` →
`b.tarayiciYenidenBaslat()`. Deneme sayacı, model kontrolü, oturum kontrolü,
rate-limit/red/geçici-hata/zaman-aşımı dalları olduğu gibi kalıyor.

`WorkerBagimliliklari` değişimi: `tarayici: UretimTarayicisi` yerine
`sekmeler: UretimSekmesi[]`, `tarayiciYenidenBaslat: () => Promise<void>` ve
`kapilar: { limit: Kapi; kullanici: Kapi; yenidenBaslatma: Kapi }`.

**Kademeli başlangıç.** İşçi `i`, ilk satırını çekmeden önce
`i × rastgeleSureMs(satirArasiBekleme)` uyur; sebep etiketi yeni bir
`UykuSebebi: 'baslangic'`. Varsayılan `[5, 15]` sn ile işçi 1 → 5-15 sn,
işçi 2 → 10-30 sn. İki gerekçe:

1. N prompt aynı milisaniyede uçmaz — otomasyon imzası zayıflar.
2. Hesap zaten limitliyse N işçi limiti aynı anda keşfedip N deneme hakkını
   birden yakmaz.

`'baslangic'` ayrı bir sebep olarak duruyor ki hem çalışma kaydında görünsün
hem de test edilebilsin (§6).

### 3.3 Koordinasyon — tasarımın kalbi

Üç durumda işçilerin ortak hareket etmesi gerekiyor: **rate limit**,
**kullanıcı müdahalesi**, **tarayıcı çökmesi**. Üçünde de kural aynı:
*ilk gören yapar, diğerleri bekler.*

İki parça yetiyor. Biri zaten var (`src/is/kapi.ts` — `Kapi`), diğeri yeni
(`src/is/tekYurutuc.ts`):

```ts
/** Aynı işi N işçiden yalnızca birine yaptırır; sonradan gelenler sürene katılır. */
export class TekYurutuc {
  private suren: Promise<void> | null = null;

  yurut(is: () => Promise<void>): Promise<void> {
    if (this.suren !== null) return this.suren;   // ikinci gelen bekler, tekrar çalıştırmaz
    this.suren = is().finally(() => { this.suren = null; });
    return this.suren;
  }
}
```

Süren iş bittikten sonra `suren` null'landığı için, sorun **hâlâ** devam
ediyorsa bir sonraki işçinin kendi tespiti yeni bir yürütme başlatır — bu
istenen davranıştır.

**Tekdüze yapı.** Üç durumun her biri bir **`Kapi` + `TekYurutuc` çifti**
alır. `TekYurutuc` "işi bir kez yaptır", `Kapi` "iş sürerken kimse yeni satır
çekmesin" der. `IsYoneticisi` bu üç çifti tutar (mevcut duraklatma `Kapi`'sına
ek olarak).

**Sarmalama nerede.** Üç sarmalamanın da tek adresi `IsYoneticisi`; bu sayede
`worker.ts` tarafında koordinasyona dair **hiç kod yok**. Worker bugünkü gibi
`b.uyu(...)`, `b.kullanicidanDevamBekle(...)`, `b.tarayiciYenidenBaslat()`
çağırmayı sürdürür; bu üç geri çağrıyı `IsYoneticisi` zaten enjekte ediyor,
artık çifti içeriyorlar:

| Worker çağrısı | `IsYoneticisi` içindeki sarmalayıcı |
|---|---|
| `b.uyu(ms, 'rateLimit')` | `uyuVeYayinla` — sebep `rateLimit` ise limit çiftiyle sarar |
| `b.kullanicidanDevamBekle(mesaj)` | `kullaniciyiBekle` — kullanıcı çiftiyle sarar |
| `b.tarayiciYenidenBaslat()` | `baslat.ts`'ten gelen ham `tarayici.yenidenBaslat`'ı yeniden başlatma çiftiyle sarar |

Böylece rate-limit dalı, `catch` bloğu ve oturum kontrolü `satiriIsle` içinde
tek satır bile değişmeden paralel-doğru hale gelir.

**Rate limit.** Limiti ilk gören işçi:

```ts
await limitYurutuc.yurut(async () => {
  limitKapisi.kapat();
  this.durumDegistir('limitBekliyor');
  await uyuMotoru(dk * 60_000, {
    signal, kapi,
    tik: (kalanMs) => this.yayinla({ tip: 'limitBekleniyor', kalanSn: Math.round(kalanMs / 1000) }),
  });
  limitKapisi.ac();
  if (!signal.aborted) this.durumDegistir('calisiyor');
});
```

Aynı sırada limit gören diğer işçiler `yurut` ile **aynı uykuya** bağlanır —
3 × 15 dk serileşip 45 dk etmez. Uyanınca hepsi kendi satırını tekrar dener;
bugünkü "aynı satır, deneme hakkı yakılmaz" davranışı korunur.

Limit görmemiş, üretimi sürmekte olan işçi kesilmez: prompt zaten kabul
edilmiştir, görsel gelebilir. Ama döngü başındaki `await limitKapisi.gec()`
onun **yeni satır çekmesini** engeller. Doğal bir boşaltma: uçuştaki işler
biter, kuyruk durur.

**Kullanıcı müdahalesi.** Aynı desen, ayrı kapı + ayrı yürütücü. Oturumun
düştüğünü (veya yanlış modeli) ilk gören kartı çıkarır ve `kullaniciKapisi`'nı
kapatır; diğerleri kapıda birikir. Kullanıcı **Giriş yaptım, devam et**'e
basınca tek promise çözülür, kapı açılır, hepsi serbest kalır. N ayrı kart
çıkmaz.

`kullaniciyiBekle` içindeki mevcut resolver-sırası koruması (resolver, olay
yayınlanmadan **önce** atanır) aynen korunuyor — senkron dinleyicilerin
`durdur()`/`kullaniciHazir()` ile anında yanıt verdiği durumda promise'in
asılı kalmasını engelliyor.

**Tarayıcı çökmesi.** Bu kendi kendini iyileştiriyor:

1. İşçi A'nın Playwright çağrısı fırlar → `satiriIsle`'nin `catch`'i
   `b.tarayiciYenidenBaslat()` çağırır → çift devreye girer: kapı kapanır,
   `TekYurutuc` yeniden başlatmayı başlatır (context kapanır, yenisi açılır,
   aynı sayıda sayfa üretilir), sonra kapı açılır.
2. Context kapandığı için **uçuşta çağrısı olan** B'nin de çağrısı fırlar →
   `catch`'e düşüp `tarayiciYenidenBaslat()` çağırır → `TekYurutuc` onu
   **süren** yeniden başlatmaya bağlar, ikinci kez başlatmaz.
3. Döngü başında bekleyen C ise yeniden başlatma kapısında durur; hiç
   Playwright çağırmadığı için hata almaz ve deneme hakkı yakmaz.
4. Biter; §3.1'deki slot mekanizması sayesinde herkesin tutamacı geçerlidir,
   A ve B kendi satırlarını tekrar dener, C temiz şekilde sıradakini çeker.

**Bilinçli ödün:** uçuşta çağrısı olan işçiler (yukarıda B), kendi hataları
olmayan bir çökme için birer deneme hakkı yakar. Kapı bunu yeni satır
çekenlerde önlüyor ama uçuştakilerde önleyemez — çağrı zaten fırlamıştır.
Bu işçileri muaf tutmak, tekrar tekrar çöken bir tarayıcıda sonsuz döngü riski
açar; mevcut emniyet valfi korunuyor.

**Durum modeli değişmiyor.** `IsDurumu` tek değer kalıyor ve bu dürüst:
kapılar global olduğu için limit kapısı kapandığında *iş* limit bekliyordur —
iki işçi son satırını boşaltıyor olsa bile kuyruk durmuştur.

## 4. Ayar

`src/depo/projeler.ts`:

- `Ayarlar`'a `esZamanliSekme: number` eklenir. Geçerli aralık **1-4** tam
  sayı. `VARSAYILAN_AYARLAR.esZamanliSekme = 1`.
- Doğrulama `pozitifSayiDogrula` kardeşi bir `aralikliSayiDogrula(ham, 1, 4)`
  ile yapılır (tam sayı olmayan, aralık dışı ve sayı olmayan değerler
  reddedilir).
- **Göç bedava:** `ayarlarDogrula` zaten
  `if (ham === undefined) return VARSAYILAN_AYARLAR[alan]` deseniyle çalışıyor;
  alanı olmayan eski proje dosyaları `1` alır. `gocEt`'e dokunulmuyor.
- `projedenConfig` alanı `Config`'e taşır.

`src/baslat.ts` → `isBaslat`:

```ts
const n = Math.min(config.esZamanliSekme, Math.max(proje.satirlar.length, 1));
const sekmeler = await tarayici.sekmeleriHazirla(n);
```

Kırpma, 2 satırlık projede 4 sekme açılmasını engeller.

## 5. Arayüz

**Ayarlar modalı.** Sayı girdisi (`min=1 max=4`) + tek satır açıklama:

> 1 = sırayla. Yükseltmek üretimi hızlandırır, ama ChatGPT kotası hesap
> başınadır — limit daha erken gelebilir.

Çalışan projede alan salt-okunur olur (mevcut davranış, ek kod istemez).

**İlerleme paneli** (`web/js/ilerleme.js`). Sayaç `sira/toplam` yerine
`biten/toplam`; altına uçuştaki satırlar:

```
Çalışıyor
7/20 · ✓ 6 · atlanan 0 · ✗ 1
Üretiliyor: bisiklet_yesil · sapka_sari · masa_mavi
```

Üst şerit de `▶ proje — biten/toplam`'a geçer.

**Olay ve durum değişiklikleri:**

| Yer | Değişiklik | Sebep |
|---|---|---|
| `IsOlayi.satirBitti` | `dosyaAdi: string` eklenir | UI satırı "Üretiliyor" listesinden çıkarabilsin; bugün sadece `satirBasladi` taşıyor, tek işçide yeterliydi |
| `IsOlayi.satirBitti` | `ozet: IslemOzeti` eklenir | **Mevcut hatanın düzeltmesi.** Olay bugün özet taşımadığı için `✓ / atlanan / ✗` sayaçları yalnızca durum değişimlerinde tazeleniyor, koşu boyunca donuk kalıyor. Yeni `biten` sayacı da aynı kaynaktan besleneceği için düzeltme zorunlu |
| `IsBilgisi` | `biten: number`, `ucusta: string[]` eklenir | Sayfayı iş ortasında yenileyen kullanıcı doğru görsün |
| `web/js/durum.js` | state'e `ucusta: string[]` | — |
| `web/js/akis.js` | `satirBasladi` → listeye ekle, `satirBitti` → çıkar | — |

`GET /api/is` yeni alanları döndürür. Bu, `isDurumunuTazele`'deki mevcut
yorumun gerekçesinin aynısıdır: SSE'nin açılışta yolladığı `durum` olayı
sayıları taşımıyor; bu uç olmadan yenilemeden sonra "Üretiliyor" listesi bir
sonraki `satirBasladi`'ya kadar boş kalırdı.

`sira` alanı olaylarda **kalır** (satır → sonuç eşlemesi için gerekli),
sadece ekranda kullanılmaz.

**Sekmelerin sonu.** İş kendiliğinden bitince `baslat.ts` zaten tüm tarayıcıyı
kapatıyor; N sekme de gider. Durdurulmuşsa açık kalır — mevcut gerekçe
("durdurmuşsan bir şeye bakmak istiyorsundur") N sekmede de geçerli.

## 6. Test

`tests/worker.test.ts`'teki `sahteTarayici`, `UretimSekmesi[]` üreten
`sahteSekmeler(n)` + ortak `tarayiciYenidenBaslat` casusuna dönüşür.

| Test | Ne kanıtlar |
|---|---|
| **N=1 regresyon** — mevcut `worker.test.ts`'in tamamı aynen geçer | Davranış korunumu; kaçış yolunun gerçekten çalıştığının kanıtı |
| **Kuyruk bütünlüğü** — N=3, 7 satır | Her satır tam bir kez işlenir: `uret` çağrısı 7, tekrar yok, atlama yok |
| **`TekYurutuc`** — yeni `tests/tekYurutuc.test.ts` | İkinci çağrı işi tekrar çalıştırmaz, sürene bağlanır; süren bittikten sonra yeni çağrı yeniden çalıştırır |
| **Tek uyku** — iki sekme aynı anda `rateLimit` | `beklemeler` dizisinde tek `rateLimit` kaydı. 3×15 dk serileşmesinin regresyon kilidi |
| **Limit boşaltma** — limit uykusu sürerken | Diğer işçi yeni satır çekemez |
| **Tek kart** — iki sekme `oturumAcikMi: false` | `kullaniciGerekli` olayı bir kez yayınlanır |
| **Tek yeniden başlatma** — iki sekmede `gorselUret` fırlar | Ham `tarayici.yenidenBaslat` **bir kez** çalışır (sarmalanmış geri çağrı iki kez çağrılsa da). Casus ham fonksiyona konur, sarmalayıcıya değil |
| **Kademeli başlangıç** — `satirArasiBekleme: [10, 10]` (min=maks → deterministik) | İşçi `i`'nin ilk beklemesi `i × 10000` ms, sebep `'baslangic'` |
| **Durdurma** — N=3 çalışırken abort | Üç işçi de kontrol noktasında çıkar, `Promise.all` çözülür, durum `durduruldu` |
| **`isYoneticisi.bilgi()`** | `biten` ve `ucusta` doğru; iş bitince `ucusta` boşalır |
| **`GET /api/is`** (`tests/sunucu-is.test.ts`) | Yeni alanlar yanıtta var |
| **`esZamanliSekme` doğrulaması** (`tests/projeler.test.ts`) | `0`, `5`, `2.5`, `"üç"` reddedilir; alan eksikse `1` döner (göç yolu) |

**Birim testle kanıtlanamayan tek şey:** gerçek Chromium'da N sekmenin
ChatGPT'de birlikte çalışması — `src/tarayici.ts` bugün de test dışı. Elle
canlı kontrol gerekir: **2 sekme × 4 satır** bir koşu, sonra 3 sekme. Bu aynı
zamanda §1'deki kota duvarının ilk ölçümü olur.

## 7. Riskler

| Risk | Değerlendirme |
|---|---|
| **Kota bağlayıcı çıkar, kazanç sıfır olur** | Zarar yok, sadece kazanç yok. N=1'e dönmek bir ayar değişikliği. §1'deki ölçüm bunu ilk koşuda gösterir |
| **ChatGPT eş zamanlı kullanıma tepki verir** | Kademeli başlangıç (§3.2) imzayı zayıflatır. N=1 kaçış yolu her zaman açık. Varsayılanın 1 olması, kimsenin istemeden bu riske girmemesini sağlar |
| **Yarış koşulu** | Node tek iş parçacıklı; araya girme yalnızca `await` noktalarında olur. `siradaki()` içinde `await` yok → atomik. `ozet` sayaçları, `basarisizKaydet` (`appendFileSync`), `tamamlandiMi` (`existsSync`) hepsi senkron |
| **Görselin yarım yazılması** | Bugünküyle **aynı**, bu fazın getirdiği yeni risk değil: `writeFileSync` tam `Buffer` ile çağrılıyor ve tarayıcı çökmesi yazmadan önce fırlıyor. `src/depo/atomik.ts`'i görsellere de uygulamak ayrı iş (§1 kapsam dışı) |
| **Durdurmada N yarım satır** | Tek işçide 1, N işçide N satır yarım kalır. Yarım dosya oluşmadığı için `tamamlandiMi` yanlış "bitti" demez; yeniden başlatıldığında bu satırlar normal şekilde tekrar üretilir |
