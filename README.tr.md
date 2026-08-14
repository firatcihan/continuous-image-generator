[![EN](https://img.shields.io/badge/lang-English-blue.svg)](README.md) [![TR](https://img.shields.io/badge/dil-T%C3%BCrk%C3%A7e-red.svg)](README.tr.md)

# ChatGPT Görsel Üretici

ChatGPT web arayüzünü otomatize ederek bir base prompt'un varyasyonlarıyla
toplu (100-200 adet) görsel üretir ve her birini sizin verdiğiniz adla klasöre
kaydeder. Limite takılırsa bekler, kaldığı yerden devam eder.

## Amaç

İçerik üreticilerinin görsel maliyetini düşürmek. Bir videonun her sahnesi,
bir blog serisinin her yazısı için görsel gerektiğinde API veya ücretli görsel
araçları adet başına para yazar — 200 görsel gerçek bir fatura demektir.

Bu proje **OpenAI API kullanmaz**: hâlihazırda ödediğiniz ChatGPT
aboneliğinizle, tarayıcı otomasyonu (Playwright) üzerinden üretir. Ek adet
maliyeti yok, gece boyu çalışır, sabah klasör dolu olur.

## Kurulum

Node 20+ ve yarn gerekir.

```bash
git clone https://github.com/firatcihan/chatgpt-continuous-image-generator.git
cd chatgpt-continuous-image-generator
yarn install
yarn playwright install chromium
yarn start
```

Terminalde tek kullanımlık token taşıyan adres yazılır ve tarayıcınızda açılır:

```
  ChatGPT Görsel Üretici çalışıyor:
  http://127.0.0.1:53124/?t=…
```

Sunucu yalnızca `127.0.0.1`'e bağlanır ve her istek token ister; adresi
paylaşmayın.

### AI agent'a verilecek prompt

Kurulumu kendiniz yapmak istemiyorsanız aşağıdakini bir AI agent'a (Claude
Code, Cursor, Codex…) verin:

```
https://github.com/firatcihan/chatgpt-continuous-image-generator reposunu
ev dizinime klonla ve çalıştır:

1. git clone https://github.com/firatcihan/chatgpt-continuous-image-generator.git
2. Proje klasörüne gir.
3. Node 20+ ve yarn kurulu mu bak; yoksa bu makinede nasıl kurulacağını söyle
   ve dur.
4. yarn install
5. yarn playwright install chromium
6. yarn start  (bu komut sunucuyu açık tutar, arka planda çalıştır)
7. Terminalde yazan http://127.0.0.1:PORT/?t=... adresini bana ver.

Kod tarafında hiçbir şey değiştirme. Bir adım hata verirse hatayı olduğu gibi
yaz ve dur.
```

## Kullanım

1. **`1 · Tarayıcıyı aç`** — Chromium açılır, chatgpt.com'a gider. İlk kez
   ChatGPT'ye elle giriş yapın; çerezler kalıcı profile yazılır, bir daha
   istenmez.
2. Sol panelde **+** ile proje açın (yalnızca ad yeter).
3. **Base prompt** yazın; `{VARYASYON}` yer tutucusu her satırın metniyle
   değiştirilir.
4. **Satırlar**: `metin` + `dosya adı`. Tablo, CSV veya zaman damgalı
   (`(0:12)`) bir script yapıştırarak doldurulabilir.
5. **`2 · Başlat`** — yeni sohbet → prompt → görseli bekle → indir → sıradaki
   satır. Değişiklikler otomatik kaydedilir.

Aynı anda tek iş çalışır. Program sizden bir şey beklediğinde (oturum düştü,
yanlış model) sağ kolonda kart çıkar.

Bir satır, çıktı PNG'si diskte varsa "bitti" sayılır — bu yüzden ne zaman
durdurursanız kaldığı yerden devam eder, ve iki proje aynı çıktı klasörünü
kullanamaz.

## Ayarlar

Proje adının yanındaki dişliden açılır, her proje bağımsızdır.

| Alan | Açıklama |
|---|---|
| `Çıktı klasörü` | Görsellerin kaydedileceği klasör. |
| `Satır arası bekleme` | İki görsel arası rastgele bekleme `[min, maks]` sn. |
| `Beklenen model adı` | Ör. `GPT-5`. Aktif model bunu içermiyorsa iş duraklar. |
| `Üretim zaman aşımı` | Bir görsel için azami bekleme (sn). |
| `Tekrar deneme sayısı` | Hata/zaman aşımında satır başına deneme. |
| `Limit varsayılan bekleme` | Limit mesajında süre yoksa beklenecek dakika. |
| `Eş zamanlı sekme` | 1-4. Kazanç darboğaza bağlı: gecikme ise ~N kat hızlanır, ChatGPT kotası ise kazanç yok. Varsayılan `1`; 2'de deneyip `calisma.log`'a bakın. |

## Veriler nerede

| Yol | İçerik |
|---|---|
| `~/.chatgpt-gorsel-uretici/projeler/` | Proje başına bir JSON. |
| `~/.chatgpt-gorsel-uretici/chrome_profil/` | ChatGPT giriş çerezleri. |
| `~/.chatgpt-gorsel-uretici/calisma.log` | Çalışma kaydı. |
| `~/ChatGPT-Gorseller/<slug>/` | Çıktı: `<dosya_adi>.png` + `basarisizlar.csv`. |

Kökler `GORSEL_VERI_KOKU`, `GORSEL_CIKTI_KOKU` ve `PORT` ile taşınabilir.

## Sorun giderme

- **Görsel/buton bulunamıyor:** ChatGPT arayüzü değişmiş. Tüm DOM seçicileri
  `src/selectors.ts` içinde tek dosyada.
- **Limit/red mesajı yakalanmıyor:** Kalıplar `src/rateLimit.ts` ve
  `src/browser.ts` içinde; yeni biçimi regex olarak ekleyin.
- **Arayüz 401 diyor:** Adresteki `?t=…` eskimiş. Terminaldeki güncel adresi
  kullanın.
- **Başarısız satırlar:** `basarisizlar.csv`'yi CSV moduna yapıştırıp işi
  yeniden başlatın; üretilmiş görseller atlanır.

## Geliştirme

```bash
yarn test        # vitest
yarn typecheck
```

Playwright'a dokunan tek modül `src/browser.ts`; tarayıcı `src/start.ts`'ten
enjekte edilir, geri kalan mantık birim testlidir. Arayüz `web/` altında
derleme adımı olmayan yerel ES modülleridir.
