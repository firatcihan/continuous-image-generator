# Yerel Web UI — Tasarım Dokümanı

Tarih: 2026-08-11
Durum: onay bekliyor

## 1. Amaç

Bugün terminalden çalışan ChatGPT görsel üreticiyi, kullanıcının kendi
makinesinde koşan bir web arayüzüne dönüştürmek. Araç açık kaynak kalır; sunucu
tarafı, hesap sistemi, ödeme ve merkezi depolama **yoktur**.

Kullanıcı `npx chatgpt-gorsel-uretici` yazar, varsayılan tarayıcısında bir UI
açılır. Prompt şablonunu ve varyasyon listesini oradan girer, işi başlatır,
ilerlemeyi canlı izler, biten görselleri galeride görür ve "Klasörü aç"
butonuyla dosyalara ulaşır.

### Neden bu mimari

Değerlendirilen alternatifler ve elenme sebepleri:

| Yaklaşım | Elenme sebebi |
|---|---|
| Sunucuda uzak tarayıcı çiftliği | Kullanıcının ChatGPT oturumunu saklamayı zorunlu kılıyor |
| Görsel üretim API'si (gpt-image-*) | Görsel başına maliyet; ödeme/kota altsistemi gerektiriyor |
| Chrome eklentisi | Web Store inceleme riski; mevcut Playwright kodu çöpe gidiyor |
| Electron uygulaması | Kod imzalama maliyeti ve platform başına build hattı |

Seçilen yaklaşım tüm kısıtları aynı anda karşılıyor: oturum ve görseller
kullanıcının makinesinde kalır, üretim maliyeti sıfırdır, dağıtım imzalama
gerektirmez ve mevcut Playwright kodu korunur.

## 2. Kapsam

### v1'e dahil

- Proje oluşturma/düzenleme (prompt şablonu, varyasyon listesi, ayarlar)
- Base prompt düzenleyici: serbest metin, `{VARYASYON}` doğrulaması, canlı
  önizleme
- Base prompt'a dosya/görsel ekleme ve kaldırma
- CSV içe ve dışa aktarma
- İş başlat / duraklat / devam / durdur
- Canlı ilerleme akışı: satır durumu, rate limit geri sayımı, hatalar
- Galeri — biten görseller üretildikçe görünür
- "Klasörü aç" — dosya yöneticisinde çıktı klasörünü açar
- Oturum düştü / yanlış model durumunda UI uyarısı ve "Devam et" butonu
- Seçici onarım ekranı: sağlık kontrolü, sayfadan tıklayarak seçme, aday
  seçiciler arasından seçim, vurgulayarak doğrulama, dışa/içe aktarma
- Proje/geçmiş yönetimi

### Kapsam dışı (v2+)

- Electron sarıcı
- Aynı anda birden fazla iş
- Bulut senkronizasyonu, hesap, ödeme
- Görsel üretim API'si modu
- Limit/red regex kalıplarının UI'dan düzenlenmesi

## 3. Kullanıcı akışı

1. `npx chatgpt-gorsel-uretici` → sunucu başlar, tarayıcı UI'a açılır.
2. Kullanıcı proje oluşturur: ad, base prompt (isteğe bağlı ekleriyle),
   varyasyon listesi (form veya CSV), çıktı klasörü, ayarlar. Önizleme ilk
   satırların nasıl gönderileceğini gösterir.
3. "Başlat" → Playwright ayrı bir Chromium penceresi açar, chatgpt.com'a gider.
4. **İlk kullanımda** UI "açılan pencerede ChatGPT'ye giriş yapın" der; kullanıcı
   giriş yapıp "Devam et"e basar. Oturum `chrome_profil/` klasöründe kalır,
   sonraki çalıştırmalarda tekrarlanmaz.
5. İş satır satır ilerler. Her biten görsel galeriye düşer.
6. Rate limit'e girilirse UI geri sayım gösterir; iş kendiliğinden sürer.
7. Bitince özet gösterilir. "Klasörü aç" dosyalara götürür.

### İki pencere problemi

Ekranda iki tarayıcı penceresi olur: UI penceresi (kullanıcının varsayılan
tarayıcısı) ve otomasyon penceresi (Playwright'ın açtığı Chromium). Kullanıcı
ChatGPT'ye **ikincisinde** giriş yapar.

Bu karışıklığa açık. UI ilk açılışta bunu açıkça anlatır ve
`kullaniciGerekli` durumunda hangi pencereye gidilmesi gerektiğini yazar.

## 4. Mimari

```
npx chatgpt-gorsel-uretici
        │
        └─► Node süreci
              ├─ Fastify (127.0.0.1:<port>)  ──►  Varsayılan tarayıcı = UI
              │    ├─ REST: proje CRUD, iş kontrolü, seçiciler
              │    ├─ SSE: canlı ilerleme akışı
              │    └─ statik: derlenmiş UI + galeri görselleri
              ├─ İş yöneticisi (worker sarmalı + iptal/duraklat)
              ├─ Depo (JSON dosyaları)
              └─ Playwright ──► Chromium penceresi ──► chatgpt.com
```

### Modül sınırları

Mevcut saf mantık modülleri **değişmeden** kalır: `liste`, `prompt`,
`rateLimit`, `durum`, `bekleme`, `logger`.

`src/config.ts` ikiye ayrılır: doğrulama mantığı kalır ve proje `ayarlar`
alanını doğrulamak için yeniden kullanılır; `config.json` dosyasını okuma
kısmı `depo/`'ya taşınır. Artık `config.json` diye bir dosya yoktur.

`src/main.ts` (terminal giriş noktası) **kaldırılır**. Yerine sunucuyu başlatan
`src/baslat.ts` gelir. Sebep: kullanıcı bekleme akışı (`readline` vs UI butonu)
iki farklı kod yolu demek olurdu; tek giriş noktası tutulur.

| Modül | Sorumluluk | Bağımlılık |
|---|---|---|
| `src/tarayici.ts` | Playwright'a dokunan tek yer | playwright, seçiciler |
| `src/worker.ts` | Satır döngüsü, hata/retry mantığı | tarayıcı arayüzü, kontrol |
| `src/is/` | İş durum makinesi, iptal/duraklat, olay yayını | worker |
| `src/depo/` | Proje ve geçmiş kalıcılığı, atomik yazma | fs |
| `src/seciciler/` | Varsayılan + kullanıcı override birleştirme | depo |
| `src/sunucu/` | HTTP rotaları, SSE, statik servis | is, depo, seciciler |
| `web/` | React arayüzü | — |

Playwright'a dokunan tek modülün `tarayici.ts` olması kuralı korunur.

**Değişiklik:** `tarayici.ts` bugün `seciciler.ts`'i doğrudan import ediyor.
Seçiciler artık constructor'dan geçirilecek. Sebep: kullanıcı override'ları
çalışma anında yükleniyor ve seçici test ekranının aynı örneği kullanması
gerekiyor.

## 5. Veri modeli

Kalıcılık **düz JSON dosyaları** ile yapılır. Veritabanı kullanılmaz.

Gerekçe: veri hacmi küçük (10 proje ≈ 250 KB), sorgu ihtiyacı yok,
eşzamanlılık yok. JSON dosyaları sıfır bağımlılık getirir, migration
gerektirmez ve kullanıcı projelerini metin editöründe düzenleyip
paylaşabilir — bu, aracın "kullanıcı istediği gibi değiştirsin" amacına
doğrudan hizmet eder.

### Diskteki yerleşim

```
~/.chatgpt-gorsel-uretici/
    projeler/<id>.json      proje tanımları
    projeler/<id>-ekler/    base prompt ekleri (kopyalanmış dosyalar)
    gecmis.jsonl            iş kayıtları (append-only)
    seciciler.json          kullanıcı seçici override'ları
    chrome_profil/          Playwright kalıcı Chrome profili (ChatGPT oturumu)
~/ChatGPT-Gorseller/
    <proje-slug>/           görseller (varsayılan; proje bazında değiştirilebilir)
```

`chrome_profil` **proje bazında değil, global**. Tek ChatGPT oturumu tüm
projeler arasında paylaşılır; kullanıcının her proje için yeniden giriş
yapması anlamsız olurdu. Bu yüzden proje `ayarlar` alanında yer almaz.

### Proje

```json
{
  "id": "kedi-serisi-9f2a",
  "ad": "Kedi serisi",
  "basePrompt": "Bir kedi, {VARYASYON}, yüksek detaylı",
  "ciktiKlasoru": "/Users/x/ChatGPT-Gorseller/kedi-serisi",
  "satirlar": [{ "metin": "kar yağarken dağ evinde", "dosyaAdi": "dag_evi_kis" }],
  "ekler": [
    { "id": "ek-1", "ad": "stil-referansi.png", "dosya": "ek-1.png", "boyut": 482913, "tur": "image/png" }
  ],
  "ayarlar": {
    "modelAdi": "",
    "satirArasiBekleme": [5, 15],
    "uretimZamanAsimiSn": 180,
    "tekrarDenemeSayisi": 3,
    "rateLimitVarsayilanBeklemeDk": 15
  },
  "olusturmaTarihi": "2026-08-11T10:00:00.000Z",
  "guncellemeTarihi": "2026-08-11T10:00:00.000Z"
}
```

`ayarlar`, bugünkü `Config` tipinden `basePrompt`, `ciktiKlasoru` (proje köküne
taşındı) ve `chromeProfil` (global oldu) çıkarılmış halidir.

### Geçmiş kaydı

`gecmis.jsonl` içinde satır başına bir kayıt (append-only — yeniden yazma
sırasında bozulma riski yok):

```json
{"id":"...","projeId":"...","baslangic":"...","bitis":"...","sonuc":"bitti","ozet":{"basarili":48,"atlanan":2,"basarisiz":0}}
```

`sonuc`: `bitti` | `durduruldu` | `hata`

### Atomik yazma

JSON dosyalarının tek gerçek zayıflığı yazma sırasında çökme. `depo/` katmanı
her yazmayı geçici dosyaya yapıp `rename` ile taşır (`rename` atomiktir):

```
projeler/.tmp-<id>  →  yaz  →  fsync  →  rename  →  projeler/<id>.json
```

Bozuk veya eksik alanlı dosya okunduğunda: eksik alanlar varsayılanla
doldurulur, tamamen parse edilemeyen dosya `<id>.json.bozuk` olarak
yeniden adlandırılır ve loglanır — sessizce silinmez.

## 6. Base prompt ve ekler

Base prompt, her satır için ChatGPT'ye gönderilen mesajın şablonudur. Kullanıcı
buraya **istediğini yazar** — araç içeriğe karışmaz, filtre uygulamaz, biçim
dayatmaz. Yanına dosya ve görsel ekleyebilir.

### A. Prompt düzenleyici

Çok satırlı serbest metin alanı. Tek kural: içinde `{VARYASYON}` yer tutucusu
bulunmalı. Her satırın `metin` değeri bu yer tutucunun yerine geçer.

```
Bir kedi, {VARYASYON}, yüksek detaylı, stüdyo aydınlatması
```

Yer tutucu **birden fazla kez** kullanılabilir; hepsi değiştirilir
(`replaceAll`).

**Doğrulama zorunlu.** `promptOlustur` (`src/prompt.ts:2`) yer tutucu yoksa
exception fırlatır. Bu bugün terminalde işin ilk satırda ölmesi demek. UI bunu
önden yakalar:

- Yer tutucu yoksa alan kırmızı işaretlenir, "Başlat" pasifleşir
- Mesaj: *"Prompt içinde `{VARYASYON}` yok — her satır aynı görseli üretirdi"*
- **"Yer tutucu ekle"** butonu imlecin olduğu yere `{VARYASYON}` yazar

### B. Canlı önizleme

Düzenleyicinin altında, listedeki ilk 3 satırın **gerçekte gönderilecek**
hali gösterilir:

```
1 → Bir kedi, kar yağarken dağ evinde, yüksek detaylı, stüdyo aydınlatması
2 → Bir kedi, plajda gün batımında, yüksek detaylı, stüdyo aydınlatması
3 → Bir kedi, ormanda sisli sabah, yüksek detaylı, stüdyo aydınlatması
```

Sebep: şablon hatası 200 satır boşa üretildikten sonra değil, yazarken
fark edilmeli.

### C. Ekler (dosya ve görsel)

Kullanıcı base prompt'a dosya ekleyip çıkarabilir. Tipik kullanım: stil
referans görseli, karakter sayfası, marka kılavuzu.

**Ekleme:** sürükle-bırak veya dosya seçici. UI eklenen her dosyayı küçük
resim (görselse) veya ikon + ad + boyut olarak listeler, yanında **kaldır**
butonu.

**Ekler projeye kopyalanır**, referans verilmez:

```
~/.chatgpt-gorsel-uretici/projeler/<projeId>-ekler/<ekId>.<uzanti>
```

Sebep: kullanıcı orijinal dosyayı iş ortasında taşır veya silerse iş çökerdi.
Kopya, projeyi taşınabilir de yapar.

**Her satırda yeniden yüklenir.** Her satır yeni bir sohbet açtığı için ekler
o sohbete tekrar yüklenmek zorundadır. Bu satır başına süre ekler; UI ek
eklendiğinde uyarır: *"Ekler her görselde yeniden yüklenir — 200 satırlık iş
belirgin şekilde uzar."*

### D. Tarayıcı tarafı

`UretimTarayicisi` arayüzüne yeni yöntem:

```ts
ekleriYukle(yollar: string[]): Promise<void>
```

Playwright `setInputFiles` ile gizli `input[type="file"]` alanına yazar.
İki yeni seçici gerekir (§10'daki kayda eklenir):

| Anahtar | Etiket | Beklenen eşleşme |
|---|---|---|
| `dosyaEkleGirdisi` | Dosya ekleme alanı | tekil |
| `eklenmisDosya` | Yüklenmiş ek rozeti | çoklu |

**Yükleme bitmeden prompt gönderilmez.** `eklenmisDosya` sayısı ek sayısına
ulaşana kadar beklenir. Erken gönderim eki kaybeder ve hata vermez — sessiz
bozulma, en kötü hata tipi.

Worker akışında yeri: `yeniSohbetAc()` sonrası, prompt gönderiminden önce.

### E. Sınırlar ve hata

- Dosya başına ve toplam boyut sınırı yapılandırılabilir; varsayılan olarak
  ChatGPT'nin kendi sınırına bırakılır, UI aşımı ChatGPT'nin hata mesajından
  öğrenir
- Ek yükleme zaman aşımına uğrarsa: `zamanAsimi` gibi ele alınır, deneme hakkı
  yanar, `tekrarDenemeSayisi` dolunca satır başarısız kaydedilir
- Ek dosyası diskte bulunamazsa iş başlamadan hata verilir — 200 satır
  koşturup her birinde aynı hatayı almak anlamsız

## 7. İş durum makinesi

Aynı anda **tek iş** koşar (v1 kısıtı). Tek Playwright penceresi, tek durum.

```
bosta ──► calisiyor ──► bitti
             │  ▲
             │  └─── duraklatildi
             ├────── limitBekliyor       (UI'da geri sayım)
             ├────── kullaniciBekliyor   (oturum düştü / yanlış model)
             ├────── durduruldu
             └────── hata
```

### İptal ve duraklat

`worker.ts`'in `WorkerBagimliliklari` arayüzüne bir `kontrol` nesnesi eklenir:

```ts
interface IsKontrolu {
  signal: AbortSignal;      // durdur
  kapi: Kapi;               // duraklat — await kapi.gec()
}
```

`Kapi`, duraklatılmışken bekleyen, devam edilince çözülen basit bir primitif.

**Kritik nokta:** bugünkü `uyu(dk * 60_000)` tek blok. 15 dakikalık rate-limit
uykusu sırasında Durdur'a basan kullanıcı 15 dakika beklememeli. `uyu`
kesintili hale gelir:

```ts
uyuKesintili(ms, { signal, kapi, tik: (kalanMs) => void })
```

Saniyede bir `tik` çağırır (UI geri sayımı buradan beslenir), `signal` iptal
edilince erken döner.

**Duraklat semantiği:** checkpoint'lerde etkili olur — her satır başında ve
her uyku diliminde. Üretimi ortasında kesmez; o an üretilen görsel tamamlanır,
sonra durulur.

**Durdur semantiği:** `signal` iptal edilir, uyku hemen kesilir, mevcut satır
yarıda bırakılır, tarayıcı açık kalır (kullanıcı tekrar başlatabilsin).

### Devam (resume)

Mevcut mantık korunur: çıktı PNG'si diskte varsa satır atlanır. Ayrı bir
ilerleme kaydı tutulmaz — dosya sisteminin kendisi doğruluk kaynağıdır.

## 8. HTTP API

Tümü `127.0.0.1`'e bağlanır (aşağıda Güvenlik).

### Projeler

```
GET    /api/projeler                    liste (özet)
POST   /api/projeler                    oluştur
GET    /api/projeler/:id                tam kayıt
PUT    /api/projeler/:id                güncelle
DELETE /api/projeler/:id                sil (görselleri silmez)
POST   /api/projeler/:id/ekler          ek yükle (multipart) → ek kaydı
DELETE /api/projeler/:id/ekler/:ekId    ek kaldır (dosyayı da siler)
GET    /api/projeler/:id/ekler/:ekId    ek önizleme / indirme
POST   /api/projeler/:id/onizleme       { basePrompt } → ilk 3 satırın render'ı
POST   /api/projeler/:id/csv            CSV içe aktar (text/csv gövde)
GET    /api/projeler/:id/csv            CSV dışa aktar
GET    /api/projeler/:id/galeri         üretilmiş dosyaların listesi
GET    /api/projeler/:id/gorsel/:ad     PNG servisi
POST   /api/projeler/:id/klasoru-ac     dosya yöneticisinde aç
```

### İş

```
GET    /api/is                          mevcut durum
POST   /api/is/baslat                   { projeId }
POST   /api/is/duraklat
POST   /api/is/devam
POST   /api/is/durdur
POST   /api/is/kullanici-hazir          "giriş yaptım / modeli düzelttim"
GET    /api/is/akis                     SSE
```

### Seçiciler ve geçmiş

```
GET    /api/seciciler                   tanım + varsayılan + override birleşik
PUT    /api/seciciler                   override kaydet
DELETE /api/seciciler/:anahtar          o seçiciyi varsayılana döndür
POST   /api/seciciler/saglik            tümünü ölç → [{ anahtar, eslesme, durum }]
POST   /api/seciciler/test              { secici } → { eslesme: number }
POST   /api/seciciler/vurgula           { secici } → sayfada çerçevele
POST   /api/seciciler/sec               { anahtar } → picker modunu aç
DELETE /api/seciciler/sec               picker modunu iptal et
POST   /api/tarayici/ac                 iş başlatmadan Chromium'u aç
GET    /api/gecmis                      iş kayıtları
```

Picker sonucu senkron dönmez — kullanıcı ne zaman tıklayacağı bilinmez.
Sonuç SSE ile gelir (aşağıda `seciciSecildi`).

### SSE olayları

`GET /api/is/akis` şu olayları yayınlar:

| Olay | Yük |
|---|---|
| `durum` | `{ durum, projeId, ozet }` — bağlantı açılınca da bir kez |
| `satirBasladi` | `{ sira, toplam, dosyaAdi }` |
| `gorselHazir` | `{ dosyaAdi, url }` |
| `satirBitti` | `{ sira, sonuc: "basarili"\|"atlandi"\|"basarisiz", sebep? }` |
| `limitBekleniyor` | `{ kalanSn }` — saniyede bir |
| `kullaniciGerekli` | `{ sebep: "oturum"\|"model", mesaj }` |
| `hata` | `{ mesaj, secicimiBozuk?: anahtar }` |
| `bitti` | `{ ozet }` |
| `seciciSecildi` | `{ anahtar, adaylar: [{ secici, eslesme, guven }] }` |
| `pickerIptal` | `{}` — kullanıcı Esc'e bastı |

`hata` olayındaki `secicimiBozuk`, UI'ın hata kartına "Seçiciyi onar" butonu
koymasını sağlar.

`kullaniciGerekli`, bugünkü `main.ts`'teki `readline` beklemesinin yerini alır.
UI uyarı kartı gösterir; kullanıcı `POST /api/is/kullanici-hazir` tetikleyen
butona basar.

## 9. Klasörü açma

Platform başına tek komut:

```
macOS    open -R "<yol>"
Windows  explorer /select,"<yol>"
Linux    xdg-open "<klasör>"
```

**Kısıt:** verilen yol, o projenin çıktı klasörünün içinde olmak zorundadır.
Sunucu yolu normalize edip kontrol eder; dışarıdaysa reddeder. Komut argüman
dizisiyle çalıştırılır, shell string'i ile değil.

## 10. Seçici yönetimi

Bu bölümün varlık sebebi: ChatGPT DOM'u değiştiğinde araç bozulur ve kullanıcı
yeni sürüm beklemeden kendi düzeltebilmelidir.

**Temel kısıt:** hedef kullanıcı CSS seçici yazamaz. Bu yüzden asıl mekanizma
elle metin girmek değil, **sayfadaki elemana tıklayarak seçtirmek**. Metin
alanı da bulunur, ama ileri seviye kaçış yolu olarak.

### Seçici kaydı

`src/seciciler.ts` her seçiciyi tanımıyla birlikte export eder:

```ts
{
  anahtar: 'promptKutusu',
  etiket: 'Prompt yazma kutusu',
  aciklama: 'ChatGPT ana sayfasında mesajı yazdığınız alan',
  varsayilan: '#prompt-textarea',
  beklenenEslesme: 'tekil',      // 'tekil' | 'coklu'
}
```

`beklenenEslesme` kritik: `promptKutusu` tam olarak 1 eşleşmeli,
`sohbetGorseli` ise **birden fazla** eşleşmeli (sohbetteki tüm görseller).
Doğrulama ve seçici türetme bu ayrıma göre farklı çalışır.

`seciciler/` katmanı `~/.chatgpt-gorsel-uretici/seciciler.json` dosyasını
varsayılanların üstüne bindirir; dosya yoksa veya bir alan eksikse varsayılan
geçerlidir.

### A. Sağlık kontrolü — giriş noktası

Kullanıcı aracın bozulduğunu fark eder, Seçiciler ekranını açar, "Tümünü
kontrol et"e basar. Her seçici için açık Chromium sayfasında
`locator(secici).count()` çalışır:

| Sonuç | İşaret |
|---|---|
| Beklenen eşleşme sağlandı | ✅ yeşil |
| 0 eşleşme | ❌ kırmızı — bozuk |
| `tekil` beklenirken >1 eşleşme | ⚠️ sarı — belirsiz |

İş sırasında bir seçici bulunamazsa UI hata mesajına **"Seçiciyi onar"**
butonu koyar ve doğrudan bu ekrana götürür. Kullanıcının sorunun ne olduğunu
kendi teşhis etmesi beklenmez.

### B. Tıklayarak seçme (picker)

Bozuk seçicinin yanındaki **"Sayfadan seç"** butonu:

1. Sunucu, açık ChatGPT sayfasına picker script'ini enjekte eder
   (`page.evaluate`).
2. Kullanıcı otomasyon penceresine geçer. Fare gezdirdikçe elemanlar
   çerçevelenir, üstte "Aradığınız elemana tıklayın — çıkmak için Esc" şeridi
   görünür.
3. Kullanıcı tıklar. Script tıklamayı yutar (sayfaya gitmez), elemanın ve
   atalarının etiket/öznitelik/rol bilgisini serileştirip Node tarafına yollar.
4. Sunucu **aday seçiciler** türetir, her birinin eşleşme sayısını ölçer ve
   SSE ile UI'a gönderir.
5. UI adayları listeler. Kullanıcı birini seçer, kaydeder.

Node ↔ sayfa iletişimi `page.exposeFunction` ile kurulur (navigasyonu aşar,
tarayıcı açılışında bir kez kaydedilir).

### C. Aday seçici türetme

Tek bir seçici üretip dayatmak yerine 2–4 aday üretilir ve **kullanıcıya
seçtirilir**. Sebep: hangisinin sağlam olduğunu makine bilemez; kullanıcı
eşleşme sayısına bakarak karar verebilir.

Öncelik sırası:

1. `data-testid` — tam eşleşme, veya kardeşleri de kapsayan prefix biçimi
   (`[data-testid^="conversation-turn"]`)
2. Diğer kararlı `data-*` öznitelikleri
3. `id` — üretilmiş/rastgele görünüyorsa (uzun hex, rakam eki) atlanır
4. `role` + erişilebilir ad
5. Etiket + kararlı sınıf — hash'lenmiş yardımcı sınıflar elenir
6. Son çare: en yakın `data-testid`'li atadan itibaren en kısa benzersiz yol

`beklenenEslesme: 'coklu'` olan seçicilerde adaylar **kasıtlı olarak
genelleştirilir** (kardeşleri de kapsasın diye), `'tekil'` olanlarda
daraltılır.

Her aday şu bilgiyle gösterilir:

```
[data-testid^="conversation-turn"] img[src^="http"]     4 eşleşme  ✅
[data-testid="conversation-turn-7"] img                 1 eşleşme  ⚠️ tekil
div.flex > img:nth-child(2)                             1 eşleşme  ⚠️ kırılgan
```

### D. Vurgulama ile doğrulama

Herhangi bir aday veya elle yazılmış seçici için **"Sayfada göster"**:
eşleşen tüm elemanlar ChatGPT sayfasında renkli çerçeveye alınır. Kullanıcı
doğru şeyi seçtiğini gözüyle görür, kaydeder.

### E. Kaçış yolları

- **Elle düzenleme:** her seçicinin metin alanı düzenlenebilir kalır.
- **Varsayılana dön:** seçici bazında veya toplu.
- **Dışa/içe aktarma:** `seciciler.json` indirilip paylaşılabilir. ChatGPT
  arayüzü değiştiğinde bir kullanıcı düzeltip yayınlar, diğerleri içe aktarır
  — yeni sürüm beklemeden dağılır.

### Tarayıcı kapalıysa

Sağlık kontrolü, picker ve vurgulama açık bir Chromium sayfası gerektirir.
Kapalıysa UI "Önce tarayıcıyı aç" butonu gösterir; buton iş başlatmadan
sadece tarayıcıyı açıp chatgpt.com'a gider.

### Test edilebilirlik sınırı

Aday türetme mantığı **saf fonksiyon** olarak ayrılır: girdisi sayfadan gelen
serileştirilmiş eleman tanımı (etiket, öznitelikler, ata zinciri), çıktısı
aday seçici listesi. Tarayıcı gerektirmeden birim testlenir.

Sayfaya enjekte edilen script yalnızca serileştirme ve olay yakalama yapar —
karar mantığı içermez.

## 11. Hata yönetimi

Mevcut davranış korunur:

| Durum | Davranış |
|---|---|
| Rate limit | Mesajdaki süre kadar (yoksa varsayılan) beklenir, **aynı satır** tekrar denenir, deneme hakkı yanmaz |
| Zaman aşımı | `tekrarDenemeSayisi` kadar denenir, sonra başarısız kaydedilir |
| İçerik reddi | Sebebiyle kaydedilir, sıradaki satıra geçilir |
| Tarayıcı çöktü | Chromium yeniden başlatılır, aynı satırdan devam |
| Oturum düştü | `kullaniciBekliyor` durumuna geçilir, deneme hakkı yanmaz |
| Yanlış model | `kullaniciBekliyor` durumuna geçilir, deneme hakkı yanmaz |
| Ek yükleme zaman aşımı | `zamanAsimi` gibi ele alınır, deneme hakkı yanar |

İş başlamadan yapılan ön kontroller (hiçbiri satır tüketmez):

- Base prompt'ta `{VARYASYON}` var mı
- Ek dosyaları diskte duruyor mu
- Çıktı klasörü yazılabilir mi

Biri başarısızsa iş hiç başlamaz, UI hatayı düzenleyicide gösterir.

Yeni: başarısız satırlar `basarisizlar.csv` yerine **proje çıktı klasöründe**
`basarisizlar.csv` olarak tutulur ve UI'da tablo halinde gösterilir. Her
başarısız satır için "yeniden dene" butonu bulunur.

Sunucu tarafı beklenmeyen hata: iş `hata` durumuna geçer, mesaj SSE ile
yayınlanır, geçmişe `sonuc: "hata"` yazılır. Süreç çökmez.

## 12. Güvenlik

Yerel sunucu olması bunu önemsiz yapmaz — arayüz kullanıcının ChatGPT
oturumunu süren bir tarayıcıyı kontrol ediyor.

1. **Sadece loopback.** Sunucu `127.0.0.1`'e bağlanır, `0.0.0.0`'a değil.
   Aksi halde aynı ağdaki herkes kullanıcının ChatGPT hesabını sürebilir.
2. **Oturum token'ı.** Başlangıçta rastgele bir token üretilir ve tarayıcı
   `http://127.0.0.1:<port>/?t=<token>` ile açılır. API istekleri token ister.
   Sebep: kullanıcı kötü niyetli bir siteyi gezerken o sitenin JavaScript'i
   `localhost`'a istek atabilir (DNS rebinding / CSRF). Token bunu engeller.
3. **Origin kontrolü.** Beklenmeyen `Origin` başlıklı istekler reddedilir.
4. **Yol doğrulama.** `klasoru-ac`, görsel servisi ve ek servisi, yolun proje
   çıktı veya ek klasörü içinde kaldığını doğrular (path traversal).
   Yüklenen eklerin dosya adı kullanıcıdan gelen adla değil, üretilen `ekId`
   ile diske yazılır — `../` içeren dosya adları etkisiz kalır.
5. **Port çakışması.** 3000 doluysa boş port bulunur, gerçek adres terminale
   yazılır.

## 13. Test stratejisi

Mevcut 38 test aynen korunur.

| Katman | Nasıl test edilir |
|---|---|
| `is/` iş yöneticisi | Sahte tarayıcı + sahte saat. Duraklat/devam/durdur, rate-limit uykusu sırasında iptal, `kullaniciBekliyor` akışı. `worker.test.ts` deseni zaten var. |
| `depo/` | Geçici dizin. Atomik yazma, bozuk dosya kurtarma, eksik alan varsayılanları, ek kopyalama ve silme. |
| `prompt` (mevcut) | Yeni: birden fazla `{VARYASYON}`, yer tutucu yokken hata, önizleme üretimi. |
| `seciciler/` | Override birleştirme, saf fonksiyon. **Aday seçici türetme** — serileştirilmiş eleman tanımları girdi, aday listesi çıktı; tarayıcısız birim test. Kapsanacak vakalar: `data-testid` varken tercih edilmesi, rastgele `id`'nin elenmesi, `coklu` beklenirken genelleştirme, `tekil` beklenirken daraltma, hiçbir kararlı öznitelik yokken yol üretimi. |
| `sunucu/` | `fastify.inject()`. Rota sözleşmeleri, token/origin reddi, yol doğrulama. |
| `web/` | Test yok — UI mantığı ince tutulur. |

Gerçek Playwright ve gerçek ChatGPT test edilmez; bu sınır bugünkü projede de
geçerli ve korunuyor.

## 14. Uygulama sırası

1. **İş yöneticisi + iptal/duraklat.** `Kapi`, `uyuKesintili`, `worker.ts`'e
   `kontrol` enjeksiyonu, durum makinesi, olay yayını.
2. **Sunucu + SSE + minimal UI.** Proje CRUD, base prompt düzenleyici +
   doğrulama + önizleme, başlat/durdur, canlı ilerleme, galeri, klasörü aç.
   *Bu adımın sonunda çalışan bir ürün var.*
3. **Ekler.** Yükleme/kaldırma, projeye kopyalama, `ekleriYukle` +
   yükleme tamamlanma beklemesi, ön kontroller.
4. **CSV içe/dışa aktarma.**
5. **Seçici ekranı.** Sırayla: sağlık kontrolü → vurgulama → aday türetme (saf,
   testli) → picker script + `exposeFunction` → dışa/içe aktarma.
6. **Proje/geçmiş yönetimi.**

## 15. Riskler

| Risk | Etki | Azaltma |
|---|---|---|
| ChatGPT DOM değişir | Araç tamamen bozulur | Sağlık kontrolü sorunu gösterir; tıklayarak seçme kullanıcının CSS bilmeden onarmasını sağlar; `seciciler.json` paylaşımı düzeltmeyi yayar; açık kaynak → topluluk PR'ı (§10) |
| Picker'ın ürettiği seçici kırılgan çıkar | Onarım kısa ömürlü olur | 2–4 aday + eşleşme sayısı + güven işareti gösterilir, seçim kullanıcıda; "Sayfada göster" ile gözle doğrulanır |
| İki pencere karmaşası | Kullanıcı nereye giriş yapacağını bilemez | İlk açılış anlatımı; `kullaniciGerekli` mesajında pencere adı |
| Uzun işlerde makine uyur | İş durur | UI uyarısı: "makinenin uyumasını engelleyin" |
| Ek sessizce yüklenmez | Görseller referanssız üretilir, kullanıcı geç fark eder | Prompt gönderilmeden önce `eklenmisDosya` sayısı doğrulanır (§6/D) |
| Ekler işi çok yavaşlatır | 200 satırlık iş katlanarak uzar | Ek eklendiğinde UI süre uyarısı gösterir |
| ChatGPT ToS | Hesap askıya alınabilir | Herkes kendi hesabında koşar; README'de açık uyarı |
| Node sürümü | Kurulum başarısız | Node 20+ şartı `package.json` `engines` alanında |
