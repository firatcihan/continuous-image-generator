# ChatGPT Görsel Üretici

ChatGPT web arayüzü üzerinden, bir base prompt'taki küçük varyasyonlarla toplu
(100-200 adet) görsel üretir ve her görseli sizin belirlediğiniz adla bir
klasöre kaydeder. Rate limit'e takılırsa bekler ve devam eder; programı
durdurup yeniden başlatırsanız kaldığı yerden sürer.

Projeler yerel bir web arayüzünden yönetilir: solda proje listesi, ortada base
prompt / satırlar / ayarlar, sağda canlı ilerleme ve galeri.

> OpenAI API kullanılmaz — mevcut ChatGPT aboneliğiniz ve tarayıcı otomasyonu
> (Playwright) kullanılır.

## Kurulum

```bash
yarn install
yarn playwright install chromium
```

## Çalıştırma

```bash
yarn baslat
```

Terminalde tek kullanımlık token taşıyan bir adres yazılır ve tarayıcınızda
açılır:

```
  ChatGPT Görsel Üretici çalışıyor:
  http://127.0.0.1:53124/?t=…
```

Sunucu yalnızca `127.0.0.1`'e bağlanır ve her istek token ister; adresi
paylaşmayın. Token her çalıştırmada yenilenir.

Arayüzde:

1. **`1 · Tarayıcıyı aç`** — Chromium açılır ve chatgpt.com'a gider. İlk
   çalıştırmada ChatGPT'ye elle giriş yapın; çerezler kalıcı profile yazılır,
   sonraki çalıştırmalarda giriş istenmez.
2. **`2 · Başlat`** — seçili proje işlenmeye başlar: yeni sohbet → prompt →
   görseli bekle → indir → sıradaki satır.

Aynı anda tek **iş** çalışır (bir işin içinde birden fazla sekme olabilir —
bkz. "Paralel üretim"). Program sizden bir şey beklediğinde (oturum düştü,
yanlış model) sağ kolonda kart çıkar; sorunu tarayıcıda giderip **Giriş
yaptım, devam et**'e basın.

İş kendiliğinden bittiğinde Chromium kapatılır. **Durdur**'a bastıysanız açık
bırakılır — durdurmuşsanız genelde bir şeye bakmak istiyorsunuzdur.

## Projeler

Sol paneldeki **+** ile proje açılır: yalnızca ad yazılır, gerisi otomatik
(çıktı klasörü, varsayılan ayarlar). Her projenin ayarları tamamen
bağımsızdır — ortak varsayılan yoktur.

Bir projeyi açtığınızda:

| Bölüm | Ne yapar |
|---|---|
| **Base prompt** | Prompt şablonu. `{VARYASYON}` her satırın metniyle değiştirilir. Yer tutucu yoksa uyarı çıkar ve iş başlatılmaz — yoksa her satır aynı görseli üretirdi. |
| **Önizleme** | İlk satırlar için oluşacak tam prompt'lar. |
| **Satırlar** | Tablo editörü: `metin` + `dosya adı`. Boş ve tekrar eden hücreler kırmızı işaretlenir. |
| **CSV olarak düzenle** | Aynı satırları `metin,dosya_adi` biçiminde metin olarak düzenler. Metinde virgül varsa alanı çift tırnağa alın: `"kar, tipi ve sis",dag`. Ayrıştırma sunucuda yapılır; geçersiz CSV kaydedilmez. |
| **Ayarlar** | Aşağıdaki tablo. |

### Ayarlar

| Alan | Açıklama |
|---|---|
| `Çıktı klasörü` | Görsellerin kaydedileceği klasör (yoksa oluşturulur). İki proje aynı klasörü kullanamaz. |
| `Satır arası bekleme` | İki görsel arasında beklenecek rastgele süre aralığı `[min, maks]` saniye. |
| `Beklenen model adı` | Ör. `GPT-5`. Aktif model bunu içermiyorsa iş duraklar ve sizi uyarır. Boş bırakılırsa kontrol atlanır. |
| `Üretim zaman aşımı` | Bir görselin üretimi için azami bekleme (saniye). |
| `Tekrar deneme sayısı` | Zaman aşımı/tarayıcı hatasında satır başına deneme sayısı. |
| `Limit varsayılan bekleme` | Limit mesajında süre yazmıyorsa beklenecek dakika. |
| `Eş zamanlı sekme` | Aynı anda kaç sekmede üretim yapılacağı (1-4). `1` sırayla üretir. Ayrıntı: aşağıdaki "Paralel üretim". |

Değişiklikler otomatik kaydedilir (yazmayı bıraktıktan ~0,8 sn sonra); başlık
yanındaki gösterge "Kaydedildi"/"Geçersiz — kaydedilmedi" der. Ayrı bir Kaydet
butonu yoktur: çok projede düzenleyip başka projeye geçmek değişikliği sessizce
kaybettiriyordu.

Bir iş çalışırken serbestçe gezinebilirsiniz. Üst şerit çalışan işi gösterir ve
**Projeye git** ile geri döner; diğer projelerde **Başlat** pasif olur ve
sebebini söyler. Çalışan projenin alanları salt-okunurdur.

Proje adını değiştirmek çıktı klasörünü taşımaz — üretilmiş görseller eski
klasörde yalnız kalmasın diye. Klasörü taşımak isterseniz ayarlardan elle
değiştirin.

## Veriler nerede

| Yol | İçerik |
|---|---|
| `~/.chatgpt-gorsel-uretici/projeler/<id>.json` | Proje başına bir dosya (ad, base prompt, satırlar, ayarlar). |
| `~/.chatgpt-gorsel-uretici/chrome_profil/` | Kalıcı Chrome profili — ChatGPT giriş çerezleri. Tüm projeler ortak kullanır. |
| `~/.chatgpt-gorsel-uretici/calisma.log` | Zaman damgalı çalışma kaydı. |
| `~/ChatGPT-Gorseller/<slug>/` | Varsayılan çıktı klasörü: `<dosya_adi>.png` ve `basarisizlar.csv`. |

Okunamayan bir proje dosyası silinmez, `.bozuk` uzantısıyla kenara alınır ve
sol panelde uyarı çıkar.

Kökleri ortam değişkenleriyle taşıyabilirsiniz:

| Değişken | Varsayılan |
|---|---|
| `GORSEL_VERI_KOKU` | `~/.chatgpt-gorsel-uretici` |
| `GORSEL_CIKTI_KOKU` | `~/ChatGPT-Gorseller` |
| `PORT` | rastgele boş port |

## Proje silme

Sol paneldeki `×` onay diyaloğu açar: klasörün tam yolu, içindeki görsel
sayısı ve boyutu görünür. **Görselleri de sil** kutusu varsayılan olarak
işaretlidir; kaldırırsanız yalnızca proje kaydı silinir, PNG'ler diskte kalır.

Görsel silme kasıtlı olarak dar kapsamlıdır:

- yalnızca klasörün **doğrudan içindeki** `.png` dosyaları silinir,
- alt klasörler ve diğer dosyalar (ör. `basarisizlar.csv`, notlarınız) korunur,
- klasör ancak tamamen boşaldıysa kaldırılır,
- ev dizini ya da çıktı kökü gibi korumalı bir klasör hedef gösterilmişse
  hiçbir şey silinmez; kayıtta bunu elle silmeniz gerektiği yazar.

Çalışan bir proje silinemez — önce durdurun.

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
sekmeleri birden serbest bırakır; tarayıcı çökerse bir kez yeniden başlatılır.

Sekmeler kademeli açılır (her sekme bir öncekinden "satır arası bekleme" kadar
sonra başlar); N prompt aynı anda gitmez.

Sağ kolonda sayaç `biten/toplam` gösterir ve altında o an üretimde olan
satırlar listelenir.

## Devam (Resume)

Bir satır, çıktı PNG'si diskte varsa "bitti" sayılır. İşi ne zaman
durdurursanız durdurun, yeniden başlattığınızda var olan dosyalar atlanır ve
kaldığı yerden devam eder.

Bu yüzden **iki proje aynı çıktı klasörünü kullanamaz**: aynı dosya adı iki
projede varsa biri diğerinin görselini "zaten üretilmiş" sanıp atlardı.

## Hata Yönetimi

- **Rate limit:** Mesajda süre yazıyorsa o kadar, yoksa "Limit varsayılan
  bekleme" dakika uyur ve **aynı satırı** tekrar dener; kalan süre sağ kolonda
  sayar.
- **Zaman aşımı:** "Tekrar deneme sayısı" kadar tekrar dener; olmazsa
  `basarisizlar.csv`'ye yazar ve sıradakine geçer.
- **İçerik reddi:** Sebebiyle `basarisizlar.csv`'ye yazar, devam eder.
- **Tarayıcı çöktü:** Chrome'u yeniden başlatır, aynı satırdan devam eder.
- **Oturum düştü:** Duraklar ve sizi uyarır; elle giriş yapıp **Giriş yaptım,
  devam et**'e basın.

Başarısız satırları yeniden denemek için `basarisizlar.csv`'deki satırları
CSV moduna yapıştırıp işi tekrar başlatın (üretilmiş görseller atlanacaktır).

## Sorun Giderme

**Program görseli/butonu bulamıyor:** ChatGPT arayüzü değişmiş olabilir.
Tüm DOM seçicileri tek dosyada: `src/seciciler.ts`. Tarayıcıda sağ tık →
İncele ile güncel seçiciyi bulup orayı güncelleyin.

**Limit/red mesajları yakalanmıyor:** Kalıplar `src/rateLimit.ts`
(`LIMIT_KALIPLARI`) ve `src/tarayici.ts` (`RED_KALIPLARI`) içinde; yeni mesaj
biçimini regex olarak ekleyin.

**Paralelde limit sürekli geliyor:** Eş zamanlı sekmeyi düşürün. `1` sıralı
davranışa döner ve her zaman güvenli seçenektir.

**Arayüz 401 diyor:** Adresteki `?t=…` düşmüş olabilir (yer imine
kaydettiyseniz token eskimiştir). Terminaldeki güncel adresi kullanın.

## Geliştirme

```bash
yarn test        # birim testleri (vitest)
yarn typecheck   # tip kontrolü
```

Playwright'a dokunan tek modül `src/tarayici.ts`'dir; sunucu ve depo katmanı
onu hiç import etmez, tarayıcı `src/baslat.ts`'ten enjekte edilir. Geri kalan
mantık (`depo`, `liste`, `rateLimit`, `durum`, `worker`, `is`, `sunucu`) birim
testlidir. Arayüz `web/` altında derleme adımı olmayan yerel ES modülleridir.
