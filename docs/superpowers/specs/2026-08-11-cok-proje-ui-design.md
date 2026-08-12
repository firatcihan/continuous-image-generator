# Çok Proje + UI Kabuğu — Tasarım Dokümanı

Tarih: 2026-08-11
Durum: onaylandı
Öncesi: [Yerel Web UI](2026-08-11-yerel-web-ui-design.md) · Faz 1 ve Faz 2A tamamlandı

## 1. Amaç

Bugün araç **tek** projeyle çalışıyor: diskte bir `proje.json`, ekranda tek
sayfa. Kullanıcı ikinci bir görsel serisi üretmek istediğinde mevcut promptunu
ve listesini ezmek zorunda.

Bu faz aracı çok projeli hale getirir ve ona ChatGPT'ye benzeyen bir kabuk
verir: solda proje listesi, projeye tıklayınca o projenin kendi base promptu,
kendi satır listesi, kendi parametreleri ve kendi galerisi.

### Kapsam dışı (bilinçli)

| Konu | Sebep |
|---|---|
| İş kuyruğu / paralel iş | Tek Playwright penceresi kısıtı korunuyor; çoklu tarayıcı yönetimi ayrı bir faz |
| Başka görsel sağlayıcıları (Gemini, API modu) | Sağlayıcı soyutlaması ayrı bir tasarım gerektirir |
| AI destekli varyasyon üretimi | Harici API anahtarı ve maliyet getirir |
| İş geçmişi kaydı (`gecmis.jsonl`) | Bugün de yok; çok projeyle birlikte gelmesi zorunlu değil |
| Base prompt ekleri (dosya/görsel) | Ana spec §6'da duruyor, bu fazın kapsamı dışında |
| Seçici onarım ekranı | Ana spec §10'da duruyor, bu fazın kapsamı dışında |

Üretim yetenekleri **değişmiyor**. Değişen: kaç proje tutulduğu ve ekranın
nasıl bölündüğü.

## 2. Kararlar ve gerekçeleri

Bu fazın şeklini belirleyen altı karar:

| Karar | Alternatif | Neden bu |
|---|---|---|
| Proje başına JSON dosyası | Tek `projeler.json` indeksi | Bir dosya bozulursa diğer projeler sağ kalır; tek indeksde `.bozuk` kurtarma "hepsini sıfırla" demeye dönüşür. Kullanıcı tek projeyi editörde açıp paylaşabilir |
| Ayarlar proje başına tam bağımsız | Global varsayılan + override | Düz veri modeli, tek katman doğrulama; mevcut `ayarlariDogrula` aynen çalışır. Bedeli (N projede aynı değeri N kez girmek) kabul edildi |
| Düz proje listesi | Proje > çalıştırmalar hiyerarşisi | Çalıştırma başına kalıcı kayıt ve görsel-çalıştırma ilişkisi bu fazın kapsamı dışında |
| Native ES modülleri, build yok | React + Vite | `npx` dağıtımı build adımı istemiyor; durum küçük (proje listesi, aktif proje, iş, galeri). Faz 2A'nın "build yok" kararı korunuyor |
| Otomatik kaydetme | Açık "Kaydet" butonu | Çok projede buton veri kaybı tuzağıdır: düzenle → başka projeye tıkla → sessizce git |
| Serbest gezinme, tek iş | İş sürerken paneli kilitle | 200 satırlık iş saatler sürer; o sürede başka proje hazırlanabilmeli |

## 3. Veri modeli

```ts
interface Proje {
  id: string;              // "kedi-serisi-9f2a" — slug + 4 hex
  ad: string;
  basePrompt: string;
  ciktiKlasoru: string;
  satirlar: Satir[];       // { metin, dosyaAdi }
  ayarlar: Ayarlar;        // 5 alan, bugünküyle birebir aynı
  olusturmaTarihi: string; // ISO
  guncellemeTarihi: string;
}

interface ProjeOzeti {
  id: string;
  ad: string;
  ciktiKlasoru: string;
  satirSayisi: number;
  guncellemeTarihi: string;
}
```

`Ayarlar` bugünkü tipiyle aynı kalır: `modelAdi`, `satirArasiBekleme`,
`uretimZamanAsimiSn`, `tekrarDenemeSayisi`, `rateLimitVarsayilanBeklemeDk`.

Sol panel `ProjeOzeti` listesi çeker, tam kayıt çekmez. Sebep: 20 projede her
açılışta 20 tam kaydı (satırlarıyla birlikte) taşımak gereksiz. `satirSayisi`
için sunucu her dosyayı okur; 20 küçük JSON parse'ı ölçülebilir bir maliyet
değildir ve ayrı bir indeks dosyası tutmaktan (senkron kalma yükü) daha
sağlamdır.

Özette `ciktiKlasoru` da taşınır: aynı klasör kısıtı (aşağıda) ve silme
diyaloğu bu alanı ister; olmazsa her kontrol için tüm projeler ikinci kez
okunurdu.

### Diskteki yerleşim

```
~/.chatgpt-gorsel-uretici/
    projeler/<id>.json        her proje kendi dosyası
    chrome_profil/            global — tek ChatGPT oturumu, projeye bağlı değil
~/ChatGPT-Gorseller/
    <slug>/                   görseller (proje başına, değiştirilebilir)
```

`chrome_profil` global kalır: her proje için yeniden ChatGPT girişi yapmak
anlamsız olurdu.

### id üretimi

`ad` slug'lanır (küçük harf, Türkçe karakterler ASCII'ye, boşluk `-`), sonuna 4
hex eklenir. Aynı adlı iki proje çakışmaz, dosya adı okunabilir kalır. Dosya
zaten varsa yeni hex denenir.

### Göç

Açılışta `~/.chatgpt-gorsel-uretici/proje.json` varsa:

1. Okunur ve doğrulanır (mevcut `projeDogrula`)
2. Bir `id` üretilir, `projeler/<id>.json` olarak yazılır
3. Eski dosya `proje.json.tasindi` olarak yeniden adlandırılır — **silinmez**
4. Loglanır

Bir kerelik ve geri dönülebilir. Göçten sonra `proje.json` diye bir dosya yoktur.

### İki kısıt

**1. Aynı çıktı klasörü iki projeye verilemez.** Devam mantığı "çıktı PNG'si
diskte varsa satırı atla" olduğu için klasörü paylaşan iki proje birbirinin
satırlarını bitmiş sayar ve galeriler karışır. Kaydetmede `path.resolve`
eşitliğiyle reddedilir; hata mesajı klasörü kullanan projenin adını yazar.
İç içe klasörler yasak değildir: galeri listelemesi ve devam kontrolü
`readdir`'ı özyinelemeli çalıştırmaz, bu yüzden karışma olmaz.

**2. Ad değişince çıktı klasörü otomatik değişmez.** Otomatik olsa üretilmiş
görseller eski klasörde yalnız kalırdı. Klasör yalnızca oluşturma anında addan
türetilir; sonrası kullanıcının elindedir.

## 4. Proje silme

Silme görselleri de siler. Geri dönüşü olmadığı için akış ve kısıtlar açıkça
tanımlıdır.

### Onay diyaloğu

```
"Kedi serisi" projesini sil?

  /Users/firat/ChatGPT-Gorseller/kedi-serisi
  48 görsel (12,4 MB)

  ☑ Görselleri de sil

Bu işlem geri alınamaz.        [Vazgeç]  [Sil]
```

Kutu **işaretli** gelir; ana yol görsellerin de silinmesidir. Kullanıcı
kaldırırsa yalnızca proje kaydı silinir, dosyalar kalır.

Sayı ve boyut `GET /api/projeler/:id/galeri` yanıtındaki `dosyalar.length` ve
`toplamBayt`'tan gelir, istemci tahmini değildir.

### Silme kısıtları

Yanlış yapılandırılmış bir `ciktiKlasoru` felakete dönmesin diye:

1. Yalnızca klasörün **doğrudan içindeki `.png` dosyaları** silinir. Alt
   klasörlere inilmez, başka uzantıya dokunulmaz — kullanıcının aynı klasöre
   koyduğu notlar, PSD'ler, `basarisizlar.csv` sağ kalır.
2. PNG'ler silindikten sonra klasör **boşsa** `rmdir` edilir. Boş değilse
   bırakılır.
3. Her dosya için symlink çözülmüş gerçek yol klasörün içinde mi diye kontrol
   edilir (mevcut `gercekYolIcerdeMi` yeniden kullanılır). Symlink'in gösterdiği
   hedef silinmez; silinen, symlink'in kendisidir.
4. Klasör; ev dizininin kendisi, çıktı kökünün kendisi (`~/ChatGPT-Gorseller`)
   veya veri kökü (`~/.chatgpt-gorsel-uretici`) ise görsel silme **reddedilir**:
   *"Bu klasör tek bir projeye ait görünmüyor — görselleri elle silin."* Proje
   kaydı yine silinir, kullanıcı uyarıyı görür.
5. Çalışan projenin silinmesi engellenir (önce durdurulmalı).
6. Bir dosya silinemezse (izin hatası) işlem durmaz; sonuç
   `{ silinen: number, silinemeyen: string[] }` olarak döner ve UI'da gösterilir.
   Sessiz kısmi başarı olmaz.

## 5. HTTP API

### Projeler

```
GET    /api/projeler                       → ProjeOzeti[]
POST   /api/projeler                       { ad } → 201 + Proje
GET    /api/projeler/:id                   → Proje
PUT    /api/projeler/:id                   Proje → Proje
DELETE /api/projeler/:id?gorselleriSil=1   → { silinen, silinemeyen[] }
POST   /api/projeler/:id/onizleme          { basePrompt, satirlar } → { yerTutucuVar, onizleme }
GET    /api/projeler/:id/galeri            → { dosyalar, toplamBayt }
GET    /api/projeler/:id/gorsel/:ad        → PNG
POST   /api/projeler/:id/klasoru-ac
```

Bugünkü tekil rotalar (`GET|PUT /api/proje`, `POST /api/proje/onizleme`,
`GET /api/galeri`, `GET /api/gorsel/:ad`, `POST /api/klasoru-ac`) **kaldırılır**.
Geriye dönük uyumluluk tutulmaz: araç yerel çalışır, tek istemcisi kendi UI'ıdır.

`POST /api/projeler` gövdesi yalnızca `{ ad }` alır. Sunucu id'yi, çıktı
klasörünü (`<ciktiKoku>/<slug>`), varsayılan ayarları ve örnek base promptu
(bugünkü `varsayilanProje` metni) kendisi üretir.

`DELETE` üzerindeki `gorselleriSil` parametresi **yoksa görseller silinmez** —
güvenli varsayılan. UI, onay kutusu işaretliyken `?gorselleriSil=1` gönderir.

`galeri` yanıtındaki `toplamBayt`, silme diyaloğunun "48 görsel (12,4 MB)"
satırını besler; istemci tahmini yapmaz.

Galeri ve görsel rotaları klasörü `:id`'den çözer. Faz 2A'nın iki katmanlı yol
doğrulaması (`icerdeMi` + `gercekYolIcerdeMi`) aynen korunur.

### CSV ayrıştırma

```
POST   /api/csv/ayristir              { icerik } → { satirlar } | 400 { hata }
```

CSV ayrıştırma **yalnızca sunucuda** yapılır. Tarayıcıda ikinci bir ayrıştırıcı
(tırnaklı alan, CRLF, tekrar eden dosya adı kuralları) aynı mantığın iki
kopyası demek olurdu; kopyalar zamanla ayrışır ve kullanıcı CSV'sinin
tarayıcıda geçip sunucuda reddedilmesiyle karşılaşırdı. Mevcut testli
`csvAyristir` tek doğruluk kaynağı kalır.

`src/liste.ts`'e saf `satirlariAyristir(icerik)` eklenir; başlık satırı
(`metin,dosya_adi`) isteğe bağlıdır. Terminal girişi kaldırıldığında kullanıcısı
kalmayan `listeYukle` silinir.

### İş

```
GET  /api/is                    → { durum, projeId, ozet, sira, toplam }
POST /api/is/baslat             { projeId }
POST /api/is/duraklat | devam | durdur | kullanici-hazir
GET  /api/is/akis               SSE
```

Yalnızca `baslat` değişiyor: gövdesiz iken `{ projeId }` alıyor.

### Tarayıcı

```
GET  /api/tarayici              → { acik }
POST /api/tarayici/ac
```

Değişmez.

### Üç sözleşme kararı

**1. `IsYoneticisi` hiç değişmiyor.** `IsAyarlari` içinde `projeId` alanı zaten
var, `bilgi()` zaten döndürüyor. Faz 1'in test edilmiş çekirdeğine
dokunulmuyor.

**2. Düzenleme kilidi projeye daralıyor.** Bugün `PUT /api/proje` iş çalışırken
409 döner. Artık 409 yalnızca **çalışan projenin** `PUT` ve `DELETE`'inde;
diğer projeler serbest düzenlenir. Bu, "serbest gezinme" kararının sunucu
tarafıdır: kilit UI nezaketi değil, sunucu kuralıdır — çalışan işin satır
listesi altından değiştirilemez.

**3. SSE olay tipleri değişmiyor.** `satirBasladi` / `gorselHazir` olaylarına
`projeId` eklenmiyor. Tek iş kısıtı olduğu için UI, bağlantı açılışında gelen
`durum` olayından çalışan `projeId`'yi öğrenir ve akan olayları ona bağlar.
Faz 1'in "bu arayüzler değişmeyecek" kuralı korunur.

## 6. Token ve statik servis

Bugün token URL'de (`/?t=…`) taşınıyor ve API çağrıları `x-token` başlığıyla
gönderiyor. UI modüllere bölününce bu yetmez:
`<script type="module" src="/js/api.js">` isteği ne query ne başlık taşır —
401 yer ve UI hiç açılmaz.

Çözüm: `/` yanıtında token bir cookie olarak da verilir.

```
Set-Cookie: t=<token>; Path=/; SameSite=Strict
```

Yetki kontrolü üç kaynağı kabul eder: query (`?t=`), `x-token` başlığı, cookie.

`SameSite=Strict` sayesinde kötü niyetli bir sitenin `127.0.0.1`'e attığı istek
cookie taşımaz. Mevcut `Origin` kontrolü yerinde kalır. DNS rebinding
senaryosunda saldırganın sayfası farklı bir host olduğu için `127.0.0.1`
cookie'si gönderilmez.

Statik servis: `web/` altı sunulur, uzantı allowlist (`.html`, `.js`, `.css`),
yolun `web/` içinde kaldığı doğrulanır. Ek olarak `/favicon.ico` için 204 rotası
— faz 2A'da park edilmiş, tarayıcı konsolunu kirleten 401.

## 7. UI mimarisi

Düzen: solda proje listesi, sağda iki kolon. Sol kolon projenin tüm ayarı, sağ
kolon canlı ilerleme + galeri.

```
┌────────────┬──────────────────────────────────────────────┐
│ PROJELER   │ ▶ Kedi serisi çalışıyor — 48/200      git → │
│            ├──────────────────────────────────────────────┤
│ ▸Kedi ser. │ Kedi serisi                        [Başlat] │
│  Plaj ser. ├───────────────────────┬──────────────────────┤
│  Ürün çek. │ base prompt           │ ilerleme             │
│            │ önizleme (ilk 3)      │ satır 49 üretiliyor  │
│ + Yeni     │ satırlar (tablo/CSV)  │ galeri ▦▦▦▦          │
│            │ ayarlar               │ [Klasörü aç]         │
└────────────┴───────────────────────┴──────────────────────┘
```

### Modüller

`web/` altında, build yok, `<script type="module">` ile doğrudan tarayıcıya:

| Dosya | Sorumluluk | Bağımlılık |
|---|---|---|
| `index.html` | İskelet: sol panel, üst şerit, iki kolon kabuğu | — |
| `css/stil.css` | Tüm CSS (bugün inline, dışarı çıkıyor) | — |
| `js/api.js` | `fetch` sarmalı, token, hata normalizasyonu | — |
| `js/durum.js` | İstemci durumu + `abone()` pub-sub | — |
| `js/projeler.js` | Sol panel: liste, yeni, sil, seç | api, durum |
| `js/editor.js` | Base prompt + önizleme + ayarlar formu | api, durum |
| `js/liste.js` | Tablo editörü + CSV modu + doğrulama | durum |
| `js/galeri.js` | Galeri ızgarası | api, durum |
| `js/ilerleme.js` | Canlı ilerleme kartı + iş butonları | api, durum |
| `js/akis.js` | SSE → durum'a yazma | durum |
| `js/uygulama.js` | Wiring + yönlendirme | hepsi |

Render fonksiyonları `durum`a abone olur; olay geldiğinde ilgili bölüm yeniden
çizilir. Sanal DOM yok — mevcut UI'ın deseni sürüyor.

İstemci durumu:

```ts
{
  projeler: ProjeOzeti[],
  aktifProje: Proje | null,
  is: { durum, projeId, sira, toplam, ozet, kalanSn?, mesaj? },
  galeri: string[],
  tarayiciAcik: boolean,
  kaydetDurumu: 'bosta' | 'kaydediliyor' | 'kaydedildi' | 'gecersiz',
}
```

### Yönlendirme

`#/proje/<id>`. Sayfa yenilenince aynı projede kalınır, tarayıcının geri tuşu
çalışır.

- Hash yoksa: listedeki **ilk** proje (alfabetik) açılır
- Hash bilinmeyen bir id gösteriyorsa (404): hash temizlenir, ilk projeye düşülür
- Hiç proje yoksa: boş durum ekranı, hash yazılmaz

### Otomatik kaydetme

- 800 ms sessizlik sonrası `PUT /api/projeler/:id`
- **Yalnızca doğrulamayı geçen durum yazılır.** Geçersiz CSV veya tekrar eden
  dosya adı varken yazılmaz; gösterge "Geçersiz — kaydedilmedi" der
- Proje değiştirirken bekleyen kayıt hemen boşaltılır (debounce beklenmez)
- Gösterge: "Kaydediliyor…" / "Kaydedildi 14:32" / "Geçersiz — kaydedilmedi"

Sol panel **alfabetik** sıralıdır. "Son güncellenen üstte" olsaydı otomatik
kaydetme yazarken listeyi zıplatırdı.

### Satır listesi editörü

Varsayılan görünüm tablo: her satır iki düzenlenebilir hücre (`metin`,
`dosya_adi`), satır ekle/sil, boş veya tekrar eden `dosya_adi` kırmızı işaretli.

`CSV olarak düzenle` butonu aynı veriyi `metin,dosya_adi` textarea'sına çevirir
— toplu yapıştırma yolu kapanmaz. CSV geçersizken tabloya dönüş engellenir
(dönüştürülemez); hata mesajı hangi satırda olduğunu söyler.

200 satır doğrudan render edilir; sanal kaydırma yok.

### Çalışan proje salt-okunur

Çalışan projenin sol kolonu (prompt, satırlar, ayarlar) salt-okunur olur ve
üstünde sebebi yazar. Bu yalnızca UI davranışı değil: sunucu da 409 döner (§5).

### Üst şerit

Yalnızca iş çalışırken görünür: `▶ Kedi serisi — 48/200` + o projeye götüren
buton. Kullanıcı başka projeye gezdiğinde kaybolmaz — tek iş kısıtının
görünür karşılığı.

Diğer projelerde `Başlat` pasiftir, sebebi yazılıdır: *"bir iş zaten
çalışıyor"*.

## 8. Hata yönetimi

Mevcut üretim hata tablosu (rate limit, zaman aşımı, içerik reddi, tarayıcı
çöküşü, oturum düşmesi, yanlış model) **değişmeden** korunur.

Çok projeyle gelen yeni durumlar:

| Durum | Davranış |
|---|---|
| Proje dosyası bozuk | `.bozuk` olarak taşınır (mevcut mekanizma), listeden düşer, sol panelde uyarı: "1 proje dosyası okunamadı" |
| Bilinmeyen `:id` | 404; UI hash'i temizler, ilk projeye düşer |
| Aynı çıktı klasörü | 400 + klasörü kullanan projenin adı |
| Çalışan projeyi düzenle/sil | 409 + sebep |
| Silmede izin hatası | İşlem durmaz; `{ silinen, silinemeyen[] }` UI'da gösterilir |
| Korumalı klasör | Görsel silme reddedilir, proje kaydı silinir, uyarı gösterilir |
| Hiç proje yok | Boş durum ekranı + "Yeni proje" |
| SSE koptu | UI yeniden bağlanır, göstergede "bağlantı yok" |
| Sunucu yeniden başladı | İş yok, durum `bosta`, üst şerit kaybolur |

İş başlamadan yapılan ön kontroller (hiçbiri deneme hakkı tüketmez):
`{VARYASYON}` var mı, satır sayısı > 0, çıktı klasörü yazılabilir mi, tarayıcı
açık mı. Biri başarısızsa iş hiç başlamaz ve hata editörde gösterilir.

Başarısız satırlar bugün olduğu gibi proje çıktı klasöründeki
`basarisizlar.csv`'ye yazılır.

## 9. Test stratejisi

Mevcut 180 test korunur (`tests/projeDepo.test.ts` ve `tests/sunucu-proje.test.ts`
yeni API'ye taşınırken yerlerini `tests/projeler.test.ts` ve
`tests/sunucu-projeler.test.ts` alır).

| Katman | Yeni testler |
|---|---|
| `depo/` | Çok proje CRUD, id çakışmasında yeni hex, `proje.json` göçü (+ `.tasindi` yeniden adlandırma), bozuk dosyanın listeden düşmesi, aynı çıktı klasörü reddi |
| `depo/` silme | Yalnızca `.png` silinir, alt klasöre inilmez, symlink hedefi korunur, boş klasör `rmdir` edilir, dolu klasör bırakılır, korumalı klasör reddedilir, kısmi başarı raporlanır |
| `sunucu/` | `fastify.inject()`: yeni rota sözleşmeleri, 409'un yalnızca çalışan projeye uygulanması, 404, cookie ile yetki, statik uzantı allowlist, path traversal, `/favicon.ico` 204 |
| `prompt` / `liste` | Mevcut testler korunur; slug üretimi (Türkçe karakter) için yeni testler |
| `web/` | Test yok — UI mantığı ince tutulur |

Gerçek Playwright ve gerçek ChatGPT test edilmez; bu sınır korunur.

## 10. Uygulama sırası

1. **Depo çok projeye geçer.** `ProjeDepo`: `listele()`, `oku(id)`, `olustur(ad)`,
   `yaz(proje)`, `sil(id, gorselleriSil)`. `yollar.ts`'te `projeYolu(veriKoku)`
   yerine `projelerKlasoru(veriKoku)` + `projeDosyaYolu(veriKoku, id)`; eski
   `projeYolu` yalnızca göç kontrolü için `eskiProjeYolu` adıyla kalır. Göç, id
   üretimi, slug, aynı klasör kısıtı, silme kısıtları. Testli.
2. **Sunucu rotaları.** `/api/projeler*`, `/api/is/baslat` gövdesi, cookie token,
   statik servis, `/favicon.ico`. Testli.
3. **UI iskelet.** `index.html` + `css/stil.css` + `js/api.js` + `js/durum.js` +
   `js/uygulama.js`; sol panel, yönlendirme, boş durum.
4. **Editör.** Base prompt + `{VARYASYON}` doğrulaması + önizleme + ayarlar formu
   + otomatik kaydetme.
5. **Satır listesi.** Tablo editörü + CSV modu + doğrulama.
6. **Sağ kolon.** İlerleme kartı + iş butonları + galeri + üst şerit + salt-okunur
   kilidi.
7. **Silme.** Onay diyaloğu (sayı/boyut sunucudan), kısmi başarı gösterimi,
   korumalı klasör uyarısı.
8. **Canlı doğrulama.** Gerçek sunucu + gerçek tarayıcı: iki proje oluştur, birinde
   iş başlat, diğerine gez, şeridi ve pasif Başlat'ı doğrula, projeyi görselleriyle
   sil.

Her adım sonunda `yarn test` ve `yarn typecheck` temiz geçer.

## 11. Riskler

| Risk | Etki | Azaltma |
|---|---|---|
| Otomatik kaydetme geçersiz ara durumu diske yazar | Proje bozulur | Yalnızca doğrulamayı geçen durum yazılır; geçersizken gösterge açıkça "kaydedilmedi" der |
| Görsel silme yanlış klasörü hedefler | Kullanıcı dosyaları kaybeder | `.png` filtresi, alt klasöre inmeme, symlink kontrolü, korumalı klasör reddi, boş klasör şartı (§4) |
| Modül bölme sonrası 401 duvarı | UI hiç açılmaz | Cookie token (§6) + statik servis testleri |
| İki proje aynı klasörü gösterir | Satırlar yanlışlıkla atlanır, galeriler karışır | Kaydetmede `path.resolve` eşitliği reddi (§3) |
| Tek dosya HTML'den modüllere geçişte davranış kaybı | Çalışan özellikler bozulur | Faz 2A'nın canlı doğrulama listesi adım 8'de tekrar koşulur |
| 200+ satırda tablo yavaşlar | Yazma gecikir | 200 satır ölçüldü, doğrudan render yeterli; aşarsa CSV modu kaçış yolu |
