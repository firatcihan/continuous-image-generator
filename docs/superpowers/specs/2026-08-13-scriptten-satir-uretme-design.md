# Script'ten satır üretme — tasarım

Tarih: 2026-08-13

## Amaç

Kullanıcı elinde zaman damgalı bir konuşma metni (video scripti / transkript) var.
Bunu tek tek tabloya girmek yerine yapıştırıp satır listesine çevirebilmeli. Her
satırın dosya adı, o metin parçasının bittiği zaman damgası olur — böylece üretilen
görseller video zaman çizgisiyle eşleşir.

## Karar: ayrıştırma yerel, ChatGPT devrede değil

İlk fikir dönüşümü ChatGPT'ye yaptırmaktı: açık sekmeye talimat + script gönder,
cevaptaki CSV'yi oku. Dönüşüm tamamen mekanik olduğu için bu yol reddedildi:

- Model uzun scriptte metni kısaltır / yeniden yazar; istenen çıktı **harfi harfine**
  aynı metin.
- Görsel kotası hesap başına; her çevirme kotadan yer.
- ChatGPT girişi ve açık tarayıcı şartı, sadece liste hazırlamak için ağır.
- ~30-60 sn karşılığında regex'in ~5 ms'de yaptığı iş.

Yerel ayrıştırma deterministik, test edilebilir ve anlık. ChatGPT bu özellikte hiç
devreye girmez.

## Ayrıştırma kuralları

Yeni modül: `src/script.ts`, tek dışa açık işlev
`scriptiSatirlaraCevir(icerik: string): Satir[]`.

### Zaman damgası biçimi

Yalnızca parantez veya köşeli parantez içindeki damgalar tanınır:

```
(0:09)   [0:09]   (1:02:33)   [12:05]
```

Regex: `[(\[]\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[)\]]`

Çıplak `0:09` **tanınmaz**. Gerekçe: konuşma metninde geçen "saat 9:30'da buluştuk"
gibi ifadeler yanlış bölme noktası üretirdi.

### Bölme ve adlandırma

Metin damgalardan bölünür. Damga **i**'den ÖNCEKİ parça, damga **i** ile adlanır.
Son damgadan sonraki parça `<son damga>_son` ile adlanır.

Girdi:

```
(0:00) A (0:09) B (0:17) C (0:23) D
```

Çıktı:

| metin | dosyaAdi |
|---|---|
| A | `0_09` |
| B | `0_17` |
| C | `0_23` |
| D | `0_23_son` |

`(0:00)`'dan önceki parça boş olduğu için satır üretmez.

### Kenar durumlar

| Durum | Davranış |
|---|---|
| `:` karakteri | Dosya adında `_` olur (`0:09` → `0_09`). Kullanıcı tabloda diskteki adı görür. |
| İki ardışık damga, arası boş/boşluk | O satır atlanır, hata verilmez. |
| Aynı damga iki kez | İkinci `0_09_2`, üçüncü `0_09_3`… olur. Aksi halde kayıt "dosya adı tekrar ediyor" ile 400 döner ve kullanıcı elle temizlemek zorunda kalırdı. |
| Segment içinde satır sonu / çoklu boşluk | Tek boşluğa indirilir. Metin `{VARYASYON}` yerine geçip prompt kutusuna yazılıyor; orada satır sonunun anlamı yok. |
| İlk damgadan önce metin varsa | O parça ilk damga ile adlanır (kuralın doğal sonucu). |
| Hiç damga yok | `Error('Script içinde (0:00) biçiminde zaman damgası bulunamadı')` |
| Damga var ama tüm parçalar boş | `Error('Script içinde çevrilecek metin yok')` |

Dönen `Satir[]` doğrudan `durum.satirlar`a yazılabilecek biçimde: `metin` kırpılmış,
`dosyaAdi` `dosyaAdiTemizle` kurallarına göre temiz.

## Kalıcılık

`Proje` arayüzüne `script: string` alanı eklenir (varsayılan `''`).

- `yeniProje()` boş string verir.
- `projeDogrula()` içinde `script: metinAlan(kaynak.script, '')`.
- **Ayrı göç kodu yok**: `projeDogrula` alanları tek tek okuyor, eski proje
  dosyasında `script` yokken varsayılan `''` uygulanır. `gocEt()` değişmez.
- `projedenConfig()` değişmez — script üretim çalışmasına girmez.

Script textarea'ya yazmak mevcut otomatik kaydetme yolundan (`degisiklikBildir` →
`kaydetmeyiPlanla` → `PUT /api/projeler/:id`) diske gider. Satır listesine
DOKUNMAZ; satırlar yalnızca "Satırlara çevir" ile değişir.

## Sunucu

Yeni rota, `POST /api/script/ayristir`:

```
istek:  { icerik: string }
yanıt:  200 { satirlar: Satir[] }
        400 { hata: string }   // icerik metin değil, damga yok, metin yok
```

`/api/csv/ayristir`'ın ikizi ve aynı gerekçeyle sunucuda: ayrıştırıcının tarayıcıda
ikinci bir kopyası zamanla ayrışır, kullanıcının script'i tarayıcıda geçip sunucuda
reddedilirdi. Auth `onRequest` kancasıyla zaten kapsanıyor; token'sız istek 401.

## UI

### Mod anahtarı

`web/js/liste.js` içindeki `csvModu: boolean` yerine
`mod: 'tablo' | 'csv' | 'script'`. Satırlar başlığında üç düğme, aktif olan
işaretli. Proje değişince mod `tablo`ya döner (bugünkü `csvModu = false`
davranışının aynısı).

```
Satırlar (4)              [Tablo] [CSV] [Script]
+---------------------------------------------+
| (0:00) Bugün İstanbul'daki hava durumundan  |
| bahsedeceğiz... (0:09) sonra sıcaklık...    |
+---------------------------------------------+
[Satırlara çevir]
```

`web/index.html`: `#scriptAlani` (textarea.kod, rows 10, hidden),
`#btnCevir` ("Satırlara çevir"), mod düğmeleri. `#btnSatirEkle` yalnızca tablo
modunda, `#btnCevir` yalnızca script modunda görünür.

CSV modundan script moduna geçerken mevcut CSV→satır kuralı korunur: CSV geçersizse
mod değişmez (bugün tabloya dönerken uygulanan koruma).

### Çevirme akışı

1. `Satırlara çevir` → `POST /api/script/ayristir`
2. 400 veya ağ hatası → `#satirUyari`'da mesaj; **satırlara dokunulmaz**
3. Başarılı + mevcut satır sayısı 0 → satırlar yazılır, mod `tablo`ya geçer
4. Başarılı + mevcut satır var → onay diyaloğu:
   "4 satır silinip 6 yeni satırla değiştirilecek." [Vazgeç] [Devam]
   - Vazgeç → hiçbir şey değişmez
   - Devam → satırlar yazılır, mod `tablo`ya geçer
5. Yazımdan sonra `bildir()` → doğrulama + otomatik kayıt (mevcut yol)

Kısmi yazma yok: ya tüm satırlar değişir ya hiçbiri.

Diyalog `#cevirDiyalogu`, `silDiyalogu` gibi `#projeEkrani` DIŞINDA durur —
çalışan projede `#btnCevir` zaten sönük olduğu için diyalog hiç açılmaz.

### Kilit

Çalışan projede ek koda gerek yok: `stil.css:157`'deki
`.kilitli textarea` ve `.kilitli button:not(.serbest)` kuralları script alanını ve
`Çevir` düğmesini söndürüyor.

## Hata yönetimi

| Yer | Hata | Davranış |
|---|---|---|
| `src/script.ts` | damga yok / metin yok | `Error` fırlatır |
| rota | `icerik` string değil | 400 `{ hata: 'icerik metni gerekli' }` |
| rota | ayrıştırıcı fırlattı | 400 `{ hata: <mesaj> }` |
| UI | 400 / ağ hatası | `#satirUyari`'da mesaj, satırlar korunur |
| kayıt | satır doğrulaması 400 | mevcut "Geçersiz — kaydedilmedi" göstergesi |

## Test

| Dosya | Kapsam |
|---|---|
| `tests/script.test.ts` (yeni) | parantez + köşeli parantez, saat basamağı (`1:02:33`), bitiren-damga adlandırması, `_son` eki, çıplak `9:30` bölmez, boş segment atlanır, tekrar eden damga `_2`, satır sonu/boşluk sıkıştırma, ilk damgadan önceki metin, damga yok → hata, metin yok → hata |
| `tests/sunucu-script.test.ts` (yeni) | 200 gövdesi, 400 mesajları, token'sız 401 |
| `tests/projeler.test.ts` | `script` alanı yazılıp okunuyor; `script` alanı olmayan eski dosya `''` ile okunuyor; bilinmeyen alan diske sızmıyor |

UI birim testi yazılmaz — repoda hiç UI testi yok, mevcut desen korunur.

Doğrulama: `yarn test` + `yarn typecheck` + uygulamada gerçek zaman damgalı script
ile elle deneme.

## Kapsam dışı

- ChatGPT ile metni görsel betimlemesine çevirme (ayrı bir özellik olabilir; bu
  spec ham konuşma metnini olduğu gibi satıra taşır)
- SRT / VTT altyazı dosyası içe alma
- Segment süresine göre satır birleştirme veya bölme
