import { rastgeleSureMs } from './bekleme.js';
import { ciktiYolu } from './durum.js';
import type { Kapi } from './is/kapi.js';
import type { Logger } from './logger.js';
import { promptOlustur } from './prompt.js';
import { rateLimitAlgila } from './rateLimit.js';
import type { Config, IslemOzeti, Satir, UretimTarayicisi } from './tipler.js';

export type UykuSebebi = 'satirArasi' | 'rateLimit' | 'geciciHata';

/**
 * ChatGPT geçici hata verdiğinde tekrar denemeden önceki bekleme.
 * Kısa tutuluyor: rate limit değil, sunucu tarafı anlık aksaklık.
 */
const GECICI_HATA_BEKLEME_MS = 10_000;

export interface IsKontrolu {
  signal: AbortSignal;
  kapi: Kapi;
}

export interface WorkerBagimliliklari {
  config: Config;
  tarayici: UretimTarayicisi;
  logger: Logger;
  kontrol: IsKontrolu;
  uyu: (ms: number, sebep: UykuSebebi) => Promise<void>;
  tamamlandiMi: (dosyaAdi: string) => boolean;
  basarisizKaydet: (satir: Satir, sebep: string) => void;
  kullanicidanDevamBekle: (mesaj: string) => Promise<void>;
  satirBasladi: (sira: number, toplam: number, satir: Satir) => void;
  satirBitti: (sira: number, sonuc: 'basarili' | 'atlandi' | 'basarisiz', sebep?: string) => void;
}

export async function tumSatirlariIsle(b: WorkerBagimliliklari, satirlar: Satir[]): Promise<IslemOzeti> {
  const ozet: IslemOzeti = { basarili: 0, atlanan: 0, basarisiz: 0 };

  for (const [sira, satir] of satirlar.entries()) {
    if (b.kontrol.signal.aborted) break;
    await b.kontrol.kapi.gec();
    if (b.kontrol.signal.aborted) break;

    const sıraNo = sira + 1;

    if (b.tamamlandiMi(satir.dosyaAdi)) {
      b.logger.bilgi(`[${sıraNo}/${satirlar.length}] atlandı (zaten var): ${satir.dosyaAdi}.png`);
      ozet.atlanan++;
      b.satirBitti(sıraNo, 'atlandi');
      continue;
    }

    b.logger.bilgi(`[${sıraNo}/${satirlar.length}] işleniyor: ${satir.dosyaAdi}`);
    b.satirBasladi(sıraNo, satirlar.length, satir);

    const sonuc = await satiriIsle(b, satir);
    if (sonuc.basarili) {
      ozet.basarili++;
      b.satirBitti(sıraNo, 'basarili');
    } else {
      ozet.basarisiz++;
      b.satirBitti(sıraNo, 'basarisiz', sonuc.sebep);
    }

    await b.uyu(rastgeleSureMs(b.config.satirArasiBekleme), 'satirArasi');
  }

  return ozet;
}

interface SatirSonucu {
  basarili: boolean;
  sebep?: string;
}

async function satiriIsle(b: WorkerBagimliliklari, satir: Satir): Promise<SatirSonucu> {
  const prompt = promptOlustur(b.config.basePrompt, satir.metin);
  let deneme = 0;

  let sonSebep = 'bilinmiyor';

  while (deneme < b.config.tekrarDenemeSayisi) {
    if (b.kontrol.signal.aborted) return { basarili: false, sebep: 'durduruldu' };
    await b.kontrol.kapi.gec();
    if (b.kontrol.signal.aborted) return { basarili: false, sebep: 'durduruldu' };

    try {
      await b.tarayici.yeniSohbetAc();

      if (!(await b.tarayici.oturumAcikMi())) {
        b.logger.uyari('oturum kapalı görünüyor; kullanıcı girişi bekleniyor');
        await b.kullanicidanDevamBekle(
          'ChatGPT oturumu kapalı. Açılan tarayıcıda elle giriş yapın, sonra Devam edin.',
        );
        continue; // deneme hakkı yakılmaz
      }

      if (b.config.modelAdi !== '') {
        const aktifModel = await b.tarayici.aktifModelAdi();
        if (!aktifModel.toLowerCase().includes(b.config.modelAdi.toLowerCase())) {
          b.logger.uyari(`beklenen model "${b.config.modelAdi}", aktif model "${aktifModel}"`);
          await b.kullanicidanDevamBekle(
            `Yanlış model seçili (aktif: "${aktifModel}", beklenen: "${b.config.modelAdi}"). ` +
              'Tarayıcıdan doğru modeli seçin, sonra Devam edin.',
          );
          continue; // deneme hakkı yakılmaz
        }
      }

      const sonuc = await b.tarayici.gorselUret(prompt, b.config.uretimZamanAsimiSn);

      switch (sonuc.tip) {
        case 'gorsel': {
          await b.tarayici.sonGorseliKaydet(ciktiYolu(b.config.ciktiKlasoru, satir.dosyaAdi));
          b.logger.bilgi(`kaydedildi: ${satir.dosyaAdi}.png`);
          return { basarili: true };
        }
        case 'rateLimit': {
          const dk = rateLimitAlgila(sonuc.mesaj).beklemeDk ?? b.config.rateLimitVarsayilanBeklemeDk;
          b.logger.uyari(`rate limit algılandı; ${dk} dk bekleniyor (satır: ${satir.dosyaAdi})`);
          await b.uyu(dk * 60_000, 'rateLimit');
          continue; // aynı satır, deneme hakkı yakılmaz
        }
        case 'red': {
          const sebep = `içerik reddi: ${sonuc.mesaj.slice(0, 200)}`;
          b.logger.uyari(`${sebep} (satır: ${satir.dosyaAdi})`);
          b.basarisizKaydet(satir, sebep);
          return { basarili: false, sebep };
        }
        case 'geciciHata': {
          deneme++;
          sonSebep = 'geçici hata (ChatGPT)';
          b.logger.uyari(
            `ChatGPT geçici hata verdi (${deneme}/${b.config.tekrarDenemeSayisi}): ${satir.dosyaAdi}` +
              ` — ${sonuc.mesaj.slice(0, 120)}`,
          );
          if (deneme < b.config.tekrarDenemeSayisi) {
            await b.uyu(GECICI_HATA_BEKLEME_MS, 'geciciHata');
          }
          break;
        }
        case 'zamanAsimi': {
          deneme++;
          sonSebep = 'üretim zaman aşımı';
          b.logger.uyari(`üretim zaman aşımı (${deneme}/${b.config.tekrarDenemeSayisi}): ${satir.dosyaAdi}`);
          break;
        }
      }
    } catch (hata) {
      deneme++;
      sonSebep = `tarayıcı hatası: ${(hata as Error).message.slice(0, 120)}`;
      b.logger.hata(
        `tarayıcı hatası (${deneme}/${b.config.tekrarDenemeSayisi}): ${(hata as Error).message}; yeniden başlatılıyor`,
      );
      await b.tarayici.yenidenBaslat();
    }
  }

  // Son başarısızlığın türünü de yaz: "tekrar deneme sayısı aşıldı" tek başına
  // teşhis ettirmiyor — zaman aşımı mı, ChatGPT hatası mı, tarayıcı çökmesi mi?
  const sebep = `tekrar deneme sayısı aşıldı (${b.config.tekrarDenemeSayisi}) — son sebep: ${sonSebep}`;
  b.basarisizKaydet(satir, sebep);
  return { basarili: false, sebep };
}
