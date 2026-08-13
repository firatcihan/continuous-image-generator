import { rastgeleSureMs } from './bekleme.js';
import { ciktiYolu } from './durum.js';
import type { IsKapilari, Kapi } from './is/kapi.js';
import type { Logger } from './logger.js';
import { promptOlustur } from './prompt.js';
import { rateLimitAlgila } from './rateLimit.js';
import type { Config, IslemOzeti, Satir, UretimSekmesi } from './tipler.js';

export type UykuSebebi = 'satirArasi' | 'rateLimit' | 'geciciHata' | 'baslangic';

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
  sekmeler: UretimSekmesi[];
  tarayiciYenidenBaslat: () => Promise<void>;
  logger: Logger;
  kontrol: IsKontrolu;
  kapilar: IsKapilari;
  uyu: (ms: number, sebep: UykuSebebi) => Promise<void>;
  tamamlandiMi: (dosyaAdi: string) => boolean;
  basarisizKaydet: (satir: Satir, sebep: string) => void;
  kullanicidanDevamBekle: (mesaj: string) => Promise<void>;
  satirBasladi: (sira: number, toplam: number, satir: Satir) => void;
  satirBitti: (sira: number, sonuc: 'basarili' | 'atlandi' | 'basarisiz', sebep?: string) => void;
}

export async function tumSatirlariIsle(b: WorkerBagimliliklari, satirlar: Satir[]): Promise<IslemOzeti> {
  const ozet: IslemOzeti = { basarili: 0, atlanan: 0, basarisiz: 0 };
  let imlec = 0;

  // Okuma ile artırma arasında `await` YOK — Node tek iş parçacıklı olduğu için
  // bu atomiktir; iki işçi asla aynı satırı çekemez.
  const siradaki = (): { sira: number; satir: Satir } | null =>
    imlec < satirlar.length ? { sira: ++imlec, satir: satirlar[imlec - 1] } : null;

  await Promise.all(
    b.sekmeler.map((sekme, sira) => birIsciCalistir(b, sekme, sira, siradaki, ozet, satirlar.length)),
  );

  return ozet;
}

/** Duraklatma + üç koordinasyon kapısı. Hepsi tek yerde geçilir. */
async function kapilariGec(b: WorkerBagimliliklari): Promise<void> {
  await b.kontrol.kapi.gec();
  await b.kapilar.limit.gec();
  await b.kapilar.kullanici.gec();
  await b.kapilar.yenidenBaslatma.gec();
}

/**
 * Tek bir sekmede kuyruk boşalana kadar satır işler.
 *
 * `isciSirasi` yalnızca kademeli başlangıç için: N prompt aynı milisaniyede
 * uçarsa hem otomasyon imzası büyür hem de hesap zaten limitliyse N işçi
 * limiti aynı anda keşfedip N deneme hakkını birden yakar.
 */
async function birIsciCalistir(
  b: WorkerBagimliliklari,
  sekme: UretimSekmesi,
  isciSirasi: number,
  siradaki: () => { sira: number; satir: Satir } | null,
  ozet: IslemOzeti,
  toplam: number,
): Promise<void> {
  if (isciSirasi > 0) {
    await b.uyu(isciSirasi * rastgeleSureMs(b.config.satirArasiBekleme), 'baslangic');
  }

  for (;;) {
    if (b.kontrol.signal.aborted) return;
    await kapilariGec(b);
    if (b.kontrol.signal.aborted) return;

    const is = siradaki();
    if (is === null) return; // kuyruk boşaldı, işçi kendini çeker

    const { sira, satir } = is;

    if (b.tamamlandiMi(satir.dosyaAdi)) {
      b.logger.bilgi(`[${sira}/${toplam}] atlandı (zaten var): ${satir.dosyaAdi}.png`);
      ozet.atlanan++;
      b.satirBitti(sira, 'atlandi');
      continue;
    }

    b.logger.bilgi(`[${sira}/${toplam}] işleniyor: ${satir.dosyaAdi}`);
    b.satirBasladi(sira, toplam, satir);

    const sonuc = await satiriIsle(b, sekme, satir);
    if (sonuc.basarili) {
      ozet.basarili++;
      b.satirBitti(sira, 'basarili');
    } else {
      ozet.basarisiz++;
      b.satirBitti(sira, 'basarisiz', sonuc.sebep);
    }

    await b.uyu(rastgeleSureMs(b.config.satirArasiBekleme), 'satirArasi');
  }
}

interface SatirSonucu {
  basarili: boolean;
  sebep?: string;
}

async function satiriIsle(
  b: WorkerBagimliliklari,
  sekme: UretimSekmesi,
  satir: Satir,
): Promise<SatirSonucu> {
  const prompt = promptOlustur(b.config.basePrompt, satir.metin);
  let deneme = 0;

  let sonSebep = 'bilinmiyor';

  while (deneme < b.config.tekrarDenemeSayisi) {
    if (b.kontrol.signal.aborted) return { basarili: false, sebep: 'durduruldu' };
    await b.kontrol.kapi.gec();
    if (b.kontrol.signal.aborted) return { basarili: false, sebep: 'durduruldu' };

    try {
      await sekme.yeniSohbetAc();

      if (!(await sekme.oturumAcikMi())) {
        b.logger.uyari('oturum kapalı görünüyor; kullanıcı girişi bekleniyor');
        await b.kullanicidanDevamBekle(
          'ChatGPT oturumu kapalı. Açılan tarayıcıda elle giriş yapın, sonra Devam edin.',
        );
        continue; // deneme hakkı yakılmaz
      }

      if (b.config.modelAdi !== '') {
        const aktifModel = await sekme.aktifModelAdi();
        if (!aktifModel.toLowerCase().includes(b.config.modelAdi.toLowerCase())) {
          b.logger.uyari(`beklenen model "${b.config.modelAdi}", aktif model "${aktifModel}"`);
          await b.kullanicidanDevamBekle(
            `Yanlış model seçili (aktif: "${aktifModel}", beklenen: "${b.config.modelAdi}"). ` +
              'Tarayıcıdan doğru modeli seçin, sonra Devam edin.',
          );
          continue; // deneme hakkı yakılmaz
        }
      }

      const sonuc = await sekme.gorselUret(prompt, b.config.uretimZamanAsimiSn);

      switch (sonuc.tip) {
        case 'gorsel': {
          await sekme.sonGorseliKaydet(ciktiYolu(b.config.ciktiKlasoru, satir.dosyaAdi));
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
      await b.tarayiciYenidenBaslat();
    }
  }

  // Son başarısızlığın türünü de yaz: "tekrar deneme sayısı aşıldı" tek başına
  // teşhis ettirmiyor — zaman aşımı mı, ChatGPT hatası mı, tarayıcı çökmesi mi?
  const sebep = `tekrar deneme sayısı aşıldı (${b.config.tekrarDenemeSayisi}) — son sebep: ${sonSebep}`;
  b.basarisizKaydet(satir, sebep);
  return { basarili: false, sebep };
}
