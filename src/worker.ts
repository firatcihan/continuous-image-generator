import { rastgeleSureMs } from './bekleme.js';
import { ciktiYolu } from './durum.js';
import type { Logger } from './logger.js';
import { promptOlustur } from './prompt.js';
import { rateLimitAlgila } from './rateLimit.js';
import type { Config, IslemOzeti, Satir, UretimTarayicisi } from './tipler.js';

export interface WorkerBagimliliklari {
  config: Config;
  tarayici: UretimTarayicisi;
  logger: Logger;
  uyu: (ms: number) => Promise<void>;
  tamamlandiMi: (dosyaAdi: string) => boolean;
  basarisizKaydet: (satir: Satir, sebep: string) => void;
  kullanicidanDevamBekle: (mesaj: string) => Promise<void>;
}

export async function tumSatirlariIsle(b: WorkerBagimliliklari, satirlar: Satir[]): Promise<IslemOzeti> {
  const ozet: IslemOzeti = { basarili: 0, atlanan: 0, basarisiz: 0 };
  for (const [sira, satir] of satirlar.entries()) {
    if (b.tamamlandiMi(satir.dosyaAdi)) {
      b.logger.bilgi(`[${sira + 1}/${satirlar.length}] atlandı (zaten var): ${satir.dosyaAdi}.png`);
      ozet.atlanan++;
      continue;
    }
    b.logger.bilgi(`[${sira + 1}/${satirlar.length}] işleniyor: ${satir.dosyaAdi}`);
    if (await satiriIsle(b, satir)) {
      ozet.basarili++;
    } else {
      ozet.basarisiz++;
    }
    await b.uyu(rastgeleSureMs(b.config.satirArasiBekleme));
  }
  return ozet;
}

async function satiriIsle(b: WorkerBagimliliklari, satir: Satir): Promise<boolean> {
  const prompt = promptOlustur(b.config.basePrompt, satir.metin);
  let deneme = 0;

  while (deneme < b.config.tekrarDenemeSayisi) {
    try {
      await b.tarayici.yeniSohbetAc();

      if (!(await b.tarayici.oturumAcikMi())) {
        b.logger.uyari('oturum kapalı görünüyor; kullanıcı girişi bekleniyor');
        await b.kullanicidanDevamBekle(
          'ChatGPT oturumu kapalı. Açılan tarayıcıda elle giriş yapın, sonra Enter tuşuna basın.',
        );
        continue; // deneme hakkı yakılmaz
      }

      if (b.config.modelAdi !== '') {
        const aktifModel = await b.tarayici.aktifModelAdi();
        if (!aktifModel.toLowerCase().includes(b.config.modelAdi.toLowerCase())) {
          b.logger.uyari(`beklenen model "${b.config.modelAdi}", aktif model "${aktifModel}"`);
          await b.kullanicidanDevamBekle(
            `Yanlış model seçili (aktif: "${aktifModel}", beklenen: "${b.config.modelAdi}"). ` +
              'Tarayıcıdan doğru modeli seçin, sonra Enter tuşuna basın.',
          );
          continue; // deneme hakkı yakılmaz
        }
      }

      const sonuc = await b.tarayici.gorselUret(prompt, b.config.uretimZamanAsimiSn);

      switch (sonuc.tip) {
        case 'gorsel': {
          await b.tarayici.sonGorseliKaydet(ciktiYolu(b.config.ciktiKlasoru, satir.dosyaAdi));
          b.logger.bilgi(`kaydedildi: ${satir.dosyaAdi}.png`);
          return true;
        }
        case 'rateLimit': {
          const dk = rateLimitAlgila(sonuc.mesaj).beklemeDk ?? b.config.rateLimitVarsayilanBeklemeDk;
          b.logger.uyari(`rate limit algılandı; ${dk} dk bekleniyor (satır: ${satir.dosyaAdi})`);
          await b.uyu(dk * 60_000);
          continue; // aynı satır, deneme hakkı yakılmaz
        }
        case 'red': {
          const sebep = `içerik reddi: ${sonuc.mesaj.slice(0, 200)}`;
          b.logger.uyari(`${sebep} (satır: ${satir.dosyaAdi})`);
          b.basarisizKaydet(satir, sebep);
          return false;
        }
        case 'zamanAsimi': {
          deneme++;
          b.logger.uyari(`üretim zaman aşımı (${deneme}/${b.config.tekrarDenemeSayisi}): ${satir.dosyaAdi}`);
          break;
        }
      }
    } catch (hata) {
      deneme++;
      b.logger.hata(
        `tarayıcı hatası (${deneme}/${b.config.tekrarDenemeSayisi}): ${(hata as Error).message}; yeniden başlatılıyor`,
      );
      await b.tarayici.yenidenBaslat();
    }
  }

  b.basarisizKaydet(satir, `tekrar deneme sayısı aşıldı (${b.config.tekrarDenemeSayisi})`);
  return false;
}
