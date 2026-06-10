# ChatGPT Görsel Üretici

ChatGPT web arayüzü üzerinden, bir base prompt'taki küçük varyasyonlarla toplu
(100-200 adet) görsel üretir ve her görseli sizin belirlediğiniz adla bir
klasöre kaydeder. Rate limit'e takılırsa bekler ve devam eder; programı
durdurup yeniden başlatırsanız kaldığı yerden sürer.

> OpenAI API kullanılmaz — mevcut ChatGPT aboneliğiniz ve tarayıcı otomasyonu
> (Playwright) kullanılır.

## Kurulum

```bash
yarn install
yarn playwright install chromium
```

## Yapılandırma

Örnek dosyaları kopyalayın ve düzenleyin:

```bash
cp config.ornek.json config.json
cp liste.ornek.csv liste.csv
```

### `config.json`

| Alan | Açıklama |
|---|---|
| `basePrompt` | Prompt şablonu. `{VARYASYON}` yer tutucusu her satırın `metin` değeriyle değiştirilir. |
| `ciktiKlasoru` | Görsellerin kaydedileceği klasör (yoksa oluşturulur). |
| `chromeProfil` | Kalıcı Chrome profili klasörü. Giriş çerezleri burada saklanır. |
| `modelAdi` | Beklenen model adı (ör. `"GPT-5"`). Aktif model bunu içermiyorsa program duraklar ve sizi uyarır. Boş `""` bırakılırsa kontrol atlanır. |
| `satirArasiBekleme` | İki görsel arasında beklenecek rastgele süre aralığı `[min, maks]` saniye. |
| `uretimZamanAsimiSn` | Bir görselin üretimi için azami bekleme (saniye). |
| `tekrarDenemeSayisi` | Zaman aşımı/tarayıcı hatasında satır başına deneme sayısı. |
| `rateLimitVarsayilanBeklemeDk` | Limit mesajında süre yazmıyorsa beklenecek dakika. |

### `liste.csv`

```csv
metin,dosya_adi
kar yağarken dağ evinde,dag_evi_kis
plajda gün batımında,plaj_gunbatimi
```

Her satır bir görseldir. Çıktı `ciktiKlasoru/<dosya_adi>.png` olarak kaydedilir.
`metin` içinde virgül varsa alanı çift tırnağa alın: `"kar, tipi ve sis",dag`.

## Çalıştırma

```bash
yarn baslat                # ./config.json ve ./liste.csv kullanır
yarn baslat ./baska-config.json ./baska-liste.csv
```

1. Chrome açılır ve chatgpt.com'a gider.
2. **İlk çalıştırmada** ChatGPT'ye elle giriş yapın (çerezler `chromeProfil`
   klasörüne kaydedilir; sonraki çalıştırmalarda giriş istenmez).
3. Program satırları sırayla işler: yeni sohbet → prompt → görseli bekle →
   indir → sıradaki.

Program sizden girdi beklediğinde (oturum düştü / yanlış model) terminalde
mesaj gösterir; sorunu tarayıcıda elle giderip Enter'a basın.

## Devam (Resume)

Bir satır, çıktı PNG'si diskte varsa "bitti" sayılır. Programı ne zaman
durdurursanız durdurun, yeniden başlattığınızda var olan dosyalar atlanır ve
kaldığı yerden devam eder.

## Çıktılar

- `gorseller/<dosya_adi>.png` — üretilen görseller
- `basarisizlar.csv` — üretilemeyen satırlar (dosya adı, metin, sebep)
- `calisma.log` — zaman damgalı çalışma kaydı

Başarısız satırları yeniden denemek için: `basarisizlar.csv`'deki satırları
yeni bir liste dosyasına kopyalayıp programı o listeyle çalıştırın (dosyayı
silmeyi unutmayın, yoksa eski kayıtların üstüne ekler).

## Hata Yönetimi

- **Rate limit:** Mesajda süre yazıyorsa o kadar, yoksa
  `rateLimitVarsayilanBeklemeDk` dakika uyur ve **aynı satırı** tekrar dener.
- **Zaman aşımı:** `tekrarDenemeSayisi` kadar tekrar dener; olmazsa
  `basarisizlar.csv`'ye yazar ve sıradakine geçer.
- **İçerik reddi:** Sebebiyle `basarisizlar.csv`'ye yazar, devam eder.
- **Tarayıcı çöktü:** Chrome'u yeniden başlatır, aynı satırdan devam eder.
- **Oturum düştü:** Duraklar ve sizi uyarır; elle giriş yapıp Enter'a basın.

## Sorun Giderme

**Program görseli/butonu bulamıyor:** ChatGPT arayüzü değişmiş olabilir.
Tüm DOM seçicileri tek dosyada: `src/seciciler.ts`. Tarayıcıda sağ tık →
İncele ile güncel seçiciyi bulup orayı güncelleyin.

**Limit/red mesajları yakalanmıyor:** Kalıplar `src/rateLimit.ts`
(`LIMIT_KALIPLARI`) ve `src/tarayici.ts` (`RED_KALIPLARI`) içinde; yeni mesaj
biçimini regex olarak ekleyin.

## Geliştirme

```bash
yarn test        # birim testleri (vitest)
yarn typecheck   # tip kontrolü
```

Playwright'a dokunan tek modül `src/tarayici.ts`'dir; geri kalan mantık
(`config`, `liste`, `rateLimit`, `durum`, `worker`) birim testlidir.
