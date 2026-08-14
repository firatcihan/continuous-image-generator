import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjelerDepo, projedenConfig, type Proje } from './depo/projeler.js';
import { VARSAYILAN_CIKTI_KOKU, VARSAYILAN_VERI_KOKU, chromeProfilYolu } from './depo/yollar.js';
import { basarisizKaydet, tamamlandiMi } from './durum.js';
import { IsYoneticisi } from './is/isYoneticisi.js';
import { Logger } from './logger.js';
import { sunucuOlustur } from './sunucu/index.js';
import { tokenUret } from './sunucu/guvenlik.js';
import { klasoruAc, urlAc } from './sunucu/klasor.js';
import { ChatgptTarayicisi } from './tarayici.js';

const web = fileURLToPath(new URL('../web', import.meta.url));

async function main(): Promise<void> {
  const veriKoku = process.env.GORSEL_VERI_KOKU ?? VARSAYILAN_VERI_KOKU;
  const ciktiKoku = process.env.GORSEL_CIKTI_KOKU ?? VARSAYILAN_CIKTI_KOKU;
  mkdirSync(veriKoku, { recursive: true });

  const token = tokenUret();
  const depo = new ProjelerDepo(veriKoku, ciktiKoku);
  depo.gocEt();
  const isYoneticisi = new IsYoneticisi();
  const logger = new Logger(join(veriKoku, 'calisma.log'));
  const profil = chromeProfilYolu(veriKoku);

  let tarayici: ChatgptTarayicisi | null = null;

  /**
   * Tarayıcıyı açar ve chatgpt.com'a gider — iş başlatmaz.
   * Kullanıcı bu pencerede ChatGPT'ye giriş yapar, sonra Başlat'a basar.
   */
  const tarayiciAc = async (): Promise<void> => {
    if (tarayici) return;
    const yeni = new ChatgptTarayicisi(profil, (mesaj) => logger.bilgi(mesaj));
    await yeni.baslat(); // başarısız olursa tarayici null kalır, tekrar denenebilir
    tarayici = yeni;
    logger.bilgi('tarayıcı açıldı; ChatGPT girişi kullanıcıya bırakıldı');
  };

  /** Tarayıcıyı kapatır ve durumu sıfırlar; kapatma hatası işi etkilemez. */
  const tarayiciKapat = async (): Promise<void> => {
    const acik = tarayici;
    tarayici = null; // önce sıfırla: kapatma takılsa bile UI "kapalı" görsün
    await acik?.kapat().catch(() => {});
  };

  const isBaslat = (proje: Proje): void => {
    void (async () => {
      try {
        mkdirSync(proje.ciktiKlasoru, { recursive: true });
        await tarayiciAc();
        // Yerel sabit şart: `tarayici` daralması aşağıdaki kapanışa taşınmıyor.
        const acikTarayici = tarayici;
        if (!acikTarayici) throw new Error('tarayıcı açılamadı');

        const config = projedenConfig(proje, profil);
        // Kırpma: 2 satırlık projede 4 sekme açmanın anlamı yok.
        const sekmeSayisi = Math.min(config.esZamanliSekme, Math.max(proje.satirlar.length, 1));
        const sekmeler = await acikTarayici.sekmeleriHazirla(sekmeSayisi);

        const ozet = await isYoneticisi.baslat({
          projeId: proje.id,
          config,
          satirlar: proje.satirlar,
          sekmeler,
          tarayiciYenidenBaslat: () => acikTarayici.yenidenBaslat(),
          logger,
          tamamlandiMi: (dosyaAdi) => tamamlandiMi(proje.ciktiKlasoru, dosyaAdi),
          basarisizKaydet: (satir, sebep) =>
            basarisizKaydet(join(proje.ciktiKlasoru, 'basarisizlar.csv'), satir, sebep),
        });

        // İş kendiliğinden bittiyse tarayıcıyı kapat — 200 görsellik bir koşu
        // bitince ortada Chromium penceresi kalmasın. Kullanıcı DURDURDUYSA
        // kapatmıyoruz: durdurmuş olması genelde bir şeye bakmak istediği anlamına gelir.
        if (isYoneticisi.bilgi().durum === 'bitti') {
          await tarayiciKapat();
          logger.bilgi(
            `iş bitti (başarılı ${ozet.basarili}, atlanan ${ozet.atlanan}, ` +
              `başarısız ${ozet.basarisiz}); tarayıcı kapatıldı`,
          );
        }
      } catch (hata) {
        logger.hata(`iş başarısız: ${(hata as Error).message}`);
      }
    })();
  };

  // Gerçek port ancak listen() sonrası bilinir; izinliOrigin fonksiyon olduğu
  // için istek anında okunur ve sunucuyu iki kez ayağa kaldırmaya gerek kalmaz.
  let adres = '';

  const uygulama = sunucuOlustur({
    depo, isYoneticisi, isBaslat, token,
    tarayiciAc,
    tarayiciAcikMi: () => tarayici !== null,
    izinliOrigin: () => adres,
    webKlasoru: web, klasoruAc,
  });

  await uygulama.listen({ port: Number(process.env.PORT ?? 0), host: '127.0.0.1' });
  const port = (uygulama.server.address() as { port: number }).port;
  adres = `http://127.0.0.1:${port}`;

  const url = `${adres}/?t=${token}`;
  console.log(`\n  ChatGPT Görsel Üretici çalışıyor:\n  ${url}\n`);
  urlAc(url);

  const kapat = async () => {
    await uygulama.close();
    await tarayici?.kapat().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', kapat);
  process.on('SIGTERM', kapat);
}

main().catch((hata) => {
  console.error(`ölümcül hata: ${(hata as Error).message}`);
  process.exit(1);
});
