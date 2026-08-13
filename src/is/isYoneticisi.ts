import type { Logger } from '../logger.js';
import type { Config, IslemOzeti, Satir, UretimSekmesi } from '../tipler.js';
import { tumSatirlariIsle, type UykuSebebi } from '../worker.js';
import { Kapi, type IsKapilari } from './kapi.js';
import { TekYurutuc } from './tekYurutuc.js';
import type { IsDurumu, IsOlayi } from './olaylar.js';
import { uyuKesintili, type UykuSecenekleri } from './uyku.js';

export interface IsBilgisi {
  durum: IsDurumu;
  projeId: string | null;
  ozet: IslemOzeti;
  sira: number;
  toplam: number;
  /** basarili + atlanan + basarisiz. Paralelde `sira` anlamını yitirdi. */
  biten: number;
  /** Şu an üretimde olan satırların dosya adları. */
  ucusta: string[];
}

export interface IsAyarlari {
  projeId: string;
  config: Config;
  satirlar: Satir[];
  sekmeler: UretimSekmesi[];
  tarayiciYenidenBaslat: () => Promise<void>;
  logger: Logger;
  tamamlandiMi: (dosyaAdi: string) => boolean;
  basarisizKaydet: (satir: Satir, sebep: string) => void;
  /** Test için enjekte edilir; varsayılan uyuKesintili. */
  uyuMotoru?: (ms: number, secenekler: UykuSecenekleri) => Promise<void>;
}

const BOS_OZET: IslemOzeti = { basarili: 0, atlanan: 0, basarisiz: 0 };

function yeniKapilar(): IsKapilari {
  return { limit: new Kapi(), kullanici: new Kapi(), yenidenBaslatma: new Kapi() };
}

/** Bir üretim işinin durum makinesi; olayları dinleyicilere yayınlar. */
export class IsYoneticisi {
  private durumu: IsDurumu = 'bosta';
  private projeId: string | null = null;
  private ozet: IslemOzeti = { ...BOS_OZET };
  private sira = 0;
  private toplam = 0;
  private ucusta = new Set<string>();

  private kontrolcu = new AbortController();
  private kapi = new Kapi();
  /**
   * Üç koordinasyon çifti. `Kapi` "iş sürerken kimse yeni satır çekmesin",
   * `TekYurutuc` "işi yalnızca bir işçi yapsın" der. Sarmalama burada durduğu
   * için `worker.ts` tarafında koordinasyona dair hiç kod yok.
   */
  private kapilar: IsKapilari = yeniKapilar();
  private limitYurutuc = new TekYurutuc();
  private kullaniciYurutuc = new TekYurutuc();
  private yenidenBaslatmaYurutuc = new TekYurutuc();
  private kullaniciCozucu: (() => void) | null = null;
  private dinleyiciler = new Set<(olay: IsOlayi) => void>();
  /** duraklat() öncesi durum; devam() bu duruma geri döner (calisiyor veya limitBekliyor). */
  private duraklatmaOncesiDurum: IsDurumu | null = null;

  bilgi(): IsBilgisi {
    const ozet = { ...this.ozet };
    return {
      durum: this.durumu,
      projeId: this.projeId,
      ozet,
      sira: this.sira,
      toplam: this.toplam,
      biten: ozet.basarili + ozet.atlanan + ozet.basarisiz,
      ucusta: [...this.ucusta],
    };
  }

  dinle(dinleyici: (olay: IsOlayi) => void): () => void {
    this.dinleyiciler.add(dinleyici);
    return () => this.dinleyiciler.delete(dinleyici);
  }

  async baslat(ayarlar: IsAyarlari): Promise<IslemOzeti> {
    if (this.calisiyorMu()) throw new Error('bir iş zaten çalışıyor');

    this.kontrolcu = new AbortController();
    this.kapi = new Kapi();
    this.kapilar = yeniKapilar();
    this.limitYurutuc = new TekYurutuc();
    this.kullaniciYurutuc = new TekYurutuc();
    this.yenidenBaslatmaYurutuc = new TekYurutuc();
    this.kullaniciCozucu = null;
    this.duraklatmaOncesiDurum = null;
    this.projeId = ayarlar.projeId;
    this.ozet = { ...BOS_OZET };
    this.sira = 0;
    this.toplam = ayarlar.satirlar.length;
    this.ucusta.clear();

    const uyuMotoru = ayarlar.uyuMotoru ?? uyuKesintili;

    try {
      // İlk durum yayını try içinde: bir dinleyici burada beklenmedik şekilde
      // fırlarsa (yayinla artık dinleyici istisnalarını yutuyor, ama yine de savunma
      // amaçlı) yönetici kalıcı olarak 'calisiyor' durumunda asılı kalmaz.
      this.durumDegistir('calisiyor');

      const ozet = await tumSatirlariIsle(
        {
          config: ayarlar.config,
          sekmeler: ayarlar.sekmeler,
          tarayiciYenidenBaslat: () => this.yenidenBaslat(ayarlar.tarayiciYenidenBaslat),
          logger: ayarlar.logger,
          kontrol: { signal: this.kontrolcu.signal, kapi: this.kapi },
          kapilar: this.kapilar,
          uyu: (ms, sebep) => this.uyuVeYayinla(uyuMotoru, ms, sebep),
          tamamlandiMi: ayarlar.tamamlandiMi,
          basarisizKaydet: ayarlar.basarisizKaydet,
          kullanicidanDevamBekle: (mesaj) => this.kullaniciyiBekle(mesaj),
          satirBasladi: (sira, toplam, satir) => {
            this.sira = sira;
            this.toplam = toplam;
            this.ucusta.add(satir.dosyaAdi);
            this.yayinla({ tip: 'satirBasladi', sira, toplam, dosyaAdi: satir.dosyaAdi });
          },
          satirBitti: (sira, sonuc, sebep) => {
            // Atlanan satırlarda worker satirBasladi'yı çağırmaz; sira burada da
            // güncellenmeli, yoksa iş bittiğinde bilgi() sira:0 gösterir.
            this.sira = sira;
            if (sonuc === 'basarili') this.ozet.basarili++;
            else if (sonuc === 'atlandi') this.ozet.atlanan++;
            else this.ozet.basarisiz++;

            const satir = ayarlar.satirlar[sira - 1];
            const dosyaAdi = satir?.dosyaAdi ?? '';
            this.ucusta.delete(dosyaAdi);

            if (sonuc === 'basarili' && satir) {
              this.yayinla({ tip: 'gorselHazir', dosyaAdi });
            }
            this.yayinla({
              tip: 'satirBitti',
              sira,
              dosyaAdi,
              sonuc,
              ozet: { ...this.ozet },
              sebep,
            });
          },
        },
        ayarlar.satirlar,
      );

      this.ozet = ozet;
      this.durumDegistir(this.kontrolcu.signal.aborted ? 'durduruldu' : 'bitti');
      this.yayinla({ tip: 'bitti', ozet });
      return ozet;
    } catch (hata) {
      const mesaj = (hata as Error).message;
      this.durumDegistir('hata');
      this.yayinla({ tip: 'hata', mesaj });
      throw hata;
    }
  }

  duraklat(): void {
    if (this.durumu !== 'calisiyor' && this.durumu !== 'limitBekliyor') return;
    this.duraklatmaOncesiDurum = this.durumu;
    this.kapi.kapat();
    this.durumDegistir('duraklatildi');
  }

  devam(): void {
    if (this.durumu !== 'duraklatildi') return;
    // Rate-limit uykusu sırasında duraklatılmışsa 'calisiyor'a değil, duraklatma
    // öncesindeki 'limitBekliyor' durumuna geri dön; aksi halde UI "çalışıyor" derken
    // arka planda hâlâ süren rate-limit geri sayımı çelişkili sinyal verir.
    const hedefDurum = this.duraklatmaOncesiDurum ?? 'calisiyor';
    this.duraklatmaOncesiDurum = null;
    this.kapi.ac();
    this.durumDegistir(hedefDurum);
  }

  durdur(): void {
    if (!this.calisiyorMu()) return;
    this.kontrolcu.abort();
    // Tüm kapılar açılsın ki bekleyen işçiler döngü başına dönüp abort'u görebilsin
    this.kapi.ac();
    this.kapilar.limit.ac();
    this.kapilar.kullanici.ac();
    this.kapilar.yenidenBaslatma.ac();
    this.kullaniciCozucu?.();
    this.kullaniciCozucu = null;
  }

  kullaniciHazir(): void {
    if (this.kontrolcu.signal.aborted) return;
    if (this.durumu !== 'kullaniciBekliyor') return;
    const coz = this.kullaniciCozucu;
    this.kullaniciCozucu = null;
    this.durumDegistir('calisiyor');
    coz?.();
  }

  private calisiyorMu(): boolean {
    return ['calisiyor', 'duraklatildi', 'limitBekliyor', 'kullaniciBekliyor'].includes(this.durumu);
  }

  private async uyuVeYayinla(
    motor: (ms: number, secenekler: UykuSecenekleri) => Promise<void>,
    ms: number,
    sebep: UykuSebebi,
  ): Promise<void> {
    if (sebep === 'geciciHata') this.yayinla({ tip: 'geciciHata' });

    if (sebep !== 'rateLimit') {
      await motor(ms, { signal: this.kontrolcu.signal, kapi: this.kapi });
      return;
    }

    // N işçiden yalnızca biri uyur, diğerleri AYNI uykuya katılır; aksi halde
    // 3 işçi × 15 dk 45 dk'ya serileşirdi. Kapı ise, uyku sürerken uçuştaki
    // işini bitiren işçinin YENİ satır çekmesini engeller.
    await this.limitYurutuc.yurut(async () => {
      this.kapilar.limit.kapat();
      this.durumDegistir('limitBekliyor');
      try {
        await motor(ms, {
          signal: this.kontrolcu.signal,
          kapi: this.kapi,
          tik: (kalanMs) =>
            this.yayinla({ tip: 'limitBekleniyor', kalanSn: Math.round(kalanMs / 1000) }),
        });
      } finally {
        this.kapilar.limit.ac();
      }

      if (this.durumu === 'limitBekliyor' && !this.kontrolcu.signal.aborted) {
        this.durumDegistir('calisiyor');
      }
    });
  }

  /**
   * Tarayıcı çökmesinde: yalnızca ilk işçi gerçekten yeniden başlatır, sonraki
   * çağrılar aynı işleme katılır. Kapı, döngü başında bekleyen işçilerin yeniden
   * başlatma sürerken satır çekip boşuna deneme hakkı yakmasını önler.
   */
  private yenidenBaslat(hamYenidenBaslat: () => Promise<void>): Promise<void> {
    return this.yenidenBaslatmaYurutuc.yurut(async () => {
      this.kapilar.yenidenBaslatma.kapat();
      try {
        await hamYenidenBaslat();
      } finally {
        this.kapilar.yenidenBaslatma.ac();
      }
    });
  }

  private kullaniciyiBekle(mesaj: string): Promise<void> {
    if (this.kontrolcu.signal.aborted) return Promise.resolve();

    // İlk gören kartı çıkarır; diğer işçiler AYNI beklemeye katılır — N ayrı
    // "giriş yapın" kartı çıkmaz. Kullanıcı bir kez onaylayınca hepsi çözülür.
    return this.kullaniciYurutuc.yurut(async () => {
      this.kapilar.kullanici.kapat();
      try {
        await this.tekKullaniciBeklemesi(mesaj);
      } finally {
        this.kapilar.kullanici.ac();
      }
    });
  }

  private tekKullaniciBeklemesi(mesaj: string): Promise<void> {
    // Resolver, HERHANGİ bir olay yayınlanmadan ÖNCE atanmalı. Aksi halde senkron bir
    // dinleyici bu olaylara durdur()/kullaniciHazir() ile senkron yanıt verirse
    // (kullaniciCozucu henüz null olduğundan) hiçbir şey çözemez ve döndürülen promise
    // sonsuza kadar asılı kalır.
    const bekleyis = new Promise<void>((coz) => {
      this.kullaniciCozucu = coz;
    });

    this.durumDegistir('kullaniciBekliyor');
    this.yayinla({ tip: 'kullaniciGerekli', mesaj });

    // Yayınlardan sonra durum kontrolü: bu arada (senkron bir dinleyici içinden)
    // durdur() çağrıldıysa resolver zaten tüketilip null'lanmış olur — normal akış.
    // Ama abort olmuş olup resolver hâlâ atanmışsa (tüketilmeden), promise'i burada
    // hemen çözerek asılı bırakmayı önlüyoruz.
    if (this.kontrolcu.signal.aborted && this.kullaniciCozucu) {
      const coz = this.kullaniciCozucu;
      this.kullaniciCozucu = null;
      coz();
    }

    return bekleyis;
  }

  private durumDegistir(durum: IsDurumu): void {
    this.durumu = durum;
    this.yayinla({ tip: 'durum', durum, projeId: this.projeId, ozet: { ...this.ozet } });
  }

  private yayinla(olay: IsOlayi): void {
    // Her dinleyici izole edilir: biri fırlarsa (ör. Faz 2'de SSE istemcisi bağlantıyı
    // kapatınca yazma EPIPE fırlatır) ne diğer dinleyiciler ne de üretim işi bundan
    // etkilenmemeli. Hata sessizce kaybedilmez, loglanır.
    for (const dinleyici of this.dinleyiciler) {
      try {
        dinleyici(olay);
      } catch (hata) {
        console.error('is olayi dinleyicisinde hata:', hata);
      }
    }
  }
}
