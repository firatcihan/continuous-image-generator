import { describe, expect, it, vi } from 'vitest';
import { IsYoneticisi } from '../src/is/isYoneticisi.js';
import type { IsDurumu, IsOlayi } from '../src/is/olaylar.js';
import type { Config, GorselSonucu, Satir, UretimTarayicisi } from '../src/tipler.js';

const CONFIG: Config = {
  basePrompt: 'Bir kedi, {VARYASYON}',
  ciktiKlasoru: '/tmp/cikti',
  chromeProfil: '/tmp/profil',
  modelAdi: '',
  satirArasiBekleme: [0, 0],
  uretimZamanAsimiSn: 1,
  tekrarDenemeSayisi: 3,
  rateLimitVarsayilanBeklemeDk: 15,
};

const SATIRLAR: Satir[] = [
  { metin: 'karda', dosyaAdi: 'kedi_kar' },
  { metin: 'plajda', dosyaAdi: 'kedi_plaj' },
];

function sahteTarayici(sonuclar: GorselSonucu[] = []): UretimTarayicisi {
  const kuyruk = [...sonuclar];
  return {
    baslat: async () => {},
    yenidenBaslat: async () => {},
    yeniSohbetAc: async () => {},
    oturumAcikMi: async () => true,
    aktifModelAdi: async () => 'GPT-5',
    gorselUret: async () => kuyruk.shift() ?? { tip: 'gorsel' },
    sonGorseliKaydet: async () => {},
    kapat: async () => {},
  };
}

function ayarlar(ek: Partial<Parameters<IsYoneticisi['baslat']>[0]> = {}) {
  return {
    projeId: 'proje-1',
    config: CONFIG,
    satirlar: SATIRLAR,
    tarayici: sahteTarayici(),
    logger: { bilgi: vi.fn(), uyari: vi.fn(), hata: vi.fn() } as never,
    tamamlandiMi: () => false,
    basarisizKaydet: () => {},
    uyuMotoru: async () => {},
    ...ek,
  };
}

describe('IsYoneticisi', () => {
  it('başlangıçta bosta durumundadır', () => {
    const y = new IsYoneticisi();
    expect(y.bilgi().durum).toBe('bosta');
    expect(y.bilgi().projeId).toBeNull();
  });

  it('iş bitince bitti durumuna geçer ve özet yayınlar', async () => {
    const y = new IsYoneticisi();
    const olaylar: IsOlayi[] = [];
    y.dinle((o) => olaylar.push(o));

    const ozet = await y.baslat(ayarlar());

    expect(ozet).toEqual({ basarili: 2, atlanan: 0, basarisiz: 0 });
    expect(y.bilgi().durum).toBe('bitti');
    expect(olaylar.at(-1)).toEqual({ tip: 'bitti', ozet });
  });

  it('satır olaylarını ve görselHazır olayını yayınlar', async () => {
    const y = new IsYoneticisi();
    const olaylar: IsOlayi[] = [];
    y.dinle((o) => olaylar.push(o));

    await y.baslat(ayarlar({ satirlar: [SATIRLAR[0]] }));

    const tipler = olaylar.map((o) => o.tip);
    expect(tipler).toContain('satirBasladi');
    expect(tipler).toContain('gorselHazir');
    expect(tipler).toContain('satirBitti');
  });

  it('durdur çağrısı işi durduruldu durumuna alır', async () => {
    const y = new IsYoneticisi();
    const calisma = y.baslat(
      ayarlar({
        uyuMotoru: async () => {
          y.durdur();
        },
      }),
    );
    const ozet = await calisma;
    expect(y.bilgi().durum).toBe('durduruldu');
    expect(ozet.basarili).toBe(1);
  });

  it('duraklat ve devam durumu değiştirir', async () => {
    const y = new IsYoneticisi();
    let duraklatildi = false;
    const calisma = y.baslat(
      ayarlar({
        uyuMotoru: async () => {
          if (!duraklatildi) {
            duraklatildi = true;
            y.duraklat();
            expect(y.bilgi().durum).toBe('duraklatildi');
            setTimeout(() => y.devam(), 0);
          }
        },
      }),
    );
    await calisma;
    expect(y.bilgi().durum).toBe('bitti');
  });

  it('rate limit uykusunda limitBekliyor durumuna geçer ve geri sayım yayınlar', async () => {
    const y = new IsYoneticisi();
    const olaylar: IsOlayi[] = [];
    y.dinle((o) => olaylar.push(o));

    await y.baslat(
      ayarlar({
        satirlar: [SATIRLAR[0]],
        tarayici: sahteTarayici([{ tip: 'rateLimit', mesaj: 'Try again in 2 minutes.' }, { tip: 'gorsel' }]),
        uyuMotoru: async (_ms, secenekler) => {
          secenekler.tik?.(120_000);
        },
      }),
    );

    expect(olaylar).toContainEqual({ tip: 'limitBekleniyor', kalanSn: 120 });
  });

  it('oturum düşünce kullaniciBekliyor durumunda kalır, kullaniciHazir ile sürer', async () => {
    let oturumAcik = false;
    const tarayici = sahteTarayici();
    tarayici.oturumAcikMi = async () => oturumAcik;

    const y = new IsYoneticisi();
    const olaylar: IsOlayi[] = [];
    y.dinle((o) => {
      olaylar.push(o);
      if (o.tip === 'kullaniciGerekli') {
        oturumAcik = true;
        setTimeout(() => y.kullaniciHazir(), 0);
      }
    });

    await y.baslat(ayarlar({ satirlar: [SATIRLAR[0]], tarayici }));

    expect(olaylar.some((o) => o.tip === 'kullaniciGerekli')).toBe(true);
    expect(y.bilgi().durum).toBe('bitti');
  });

  it('aynı anda ikinci iş başlatmayı reddeder', async () => {
    const y = new IsYoneticisi();
    let cozucu: (() => void) | undefined;
    const calisma = y.baslat(
      ayarlar({
        uyuMotoru: () => new Promise<void>((coz) => (cozucu = coz)),
      }),
    );

    await Promise.resolve();
    await expect(y.baslat(ayarlar())).rejects.toThrow('zaten çalışıyor');

    cozucu?.();
    y.durdur();
    await calisma;
  });

  it('beklenmeyen hatada hata durumuna geçer ve hata olayı yayınlar', async () => {
    const tarayici = sahteTarayici();
    tarayici.yeniSohbetAc = async () => {
      throw new Error('çöktü');
    };
    tarayici.yenidenBaslat = async () => {
      throw new Error('yeniden başlatılamadı');
    };

    const y = new IsYoneticisi();
    const olaylar: IsOlayi[] = [];
    y.dinle((o) => olaylar.push(o));

    await expect(y.baslat(ayarlar({ tarayici }))).rejects.toThrow();
    expect(y.bilgi().durum).toBe('hata');
    expect(olaylar.some((o) => o.tip === 'hata')).toBe(true);
  });

  it('dinle() geri döndürdüğü fonksiyonla aboneliği iptal eder', async () => {
    const y = new IsYoneticisi();
    const olaylar: IsOlayi[] = [];
    const iptal = y.dinle((o) => olaylar.push(o));
    iptal();
    await y.baslat(ayarlar({ satirlar: [SATIRLAR[0]] }));
    expect(olaylar).toHaveLength(0);
  });

  it('durdur, rate-limit uykusu sırasında gelirse limitBekliyor sonrası sahte calisiyor durumuna dönmez', async () => {
    const y = new IsYoneticisi();
    const durumlar: IsDurumu[] = [];
    y.dinle((o) => {
      if (o.tip === 'durum') durumlar.push(o.durum);
    });

    await y.baslat(
      ayarlar({
        satirlar: [SATIRLAR[0]],
        tarayici: sahteTarayici([{ tip: 'rateLimit', mesaj: 'Try again in 2 minutes.' }]),
        uyuMotoru: async (_ms, secenekler) => {
          // sadece rate-limit uykusunda (tik tanımlı) durdur çağrısı gelir
          if (secenekler.tik) y.durdur();
        },
      }),
    );

    expect(durumlar).toEqual(['calisiyor', 'limitBekliyor', 'durduruldu']);
  });

  it('durdur sonrası gecikmiş kullaniciHazir çağrısı durumu sahte calisiyor yapmaz', async () => {
    const tarayici = sahteTarayici();
    tarayici.oturumAcikMi = async () => false;

    const y = new IsYoneticisi();
    const durumlar: IsDurumu[] = [];
    y.dinle((o) => {
      if (o.tip === 'durum') durumlar.push(o.durum);
      if (o.tip === 'kullaniciGerekli') {
        // durdur çağrısı kullaniciCozucu'yu tüketip null'lar; hemen ardından gelen
        // gecikmiş/stale kullaniciHazir çağrısı hiçbir şey yapmamalı
        setTimeout(() => {
          y.durdur();
          y.kullaniciHazir();
        }, 0);
      }
    });

    await y.baslat(ayarlar({ satirlar: [SATIRLAR[0]], tarayici }));

    expect(durumlar).toEqual(['calisiyor', 'kullaniciBekliyor', 'durduruldu']);
  });

  it(
    'kullaniciGerekli olayına senkron durdur() yanıtı kilitlenmeye yol açmaz (BULGU 1)',
    async () => {
      const tarayici = sahteTarayici();
      tarayici.oturumAcikMi = async () => false;

      const y = new IsYoneticisi();
      const durumlar: IsDurumu[] = [];
      y.dinle((o) => {
        if (o.tip === 'durum') durumlar.push(o.durum);
        if (o.tip === 'kullaniciGerekli') {
          // SENKRON yanıt: dinleyici, olay yayınından hemen çıkmadan durdur() çağırıyor.
          // kullaniciyiBekle henüz resolver'ı atamamışsa (eski kod) bu, döndürülen
          // promise'in sonsuza kadar asılı kalmasına yol açar.
          y.durdur();
        }
      });

      await expect(
        y.baslat(ayarlar({ satirlar: [SATIRLAR[0]], tarayici })),
      ).resolves.toBeDefined();

      expect(durumlar).toContain('kullaniciBekliyor');
      expect(y.bilgi().durum).toBe('durduruldu');
    },
    2000,
  );

  it('bir dinleyicinin fırlattığı istisna diğer dinleyicileri ve işi bozmaz (BULGU 2)', async () => {
    const y = new IsYoneticisi();
    const olaylar: IsOlayi[] = [];
    const hataSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Kayıt sırası önemli: ilk dinleyici HER olayda (ilk senkron 'calisiyor'
    // durum yayınında dahil) fırlıyor. Eski kodda bu, baslat()'ı try bloğuna
    // girmeden reddeder ve durumu kalıcı olarak 'calisiyor'da bırakırdı.
    y.dinle(() => {
      throw new Error('bozuk dinleyici (ör. SSE istemcisi EPIPE fırlatıyor)');
    });
    y.dinle((o) => olaylar.push(o));

    const ozet = await y.baslat(ayarlar());

    expect(ozet).toEqual({ basarili: 2, atlanan: 0, basarisiz: 0 });
    expect(y.bilgi().durum).toBe('bitti');
    expect(olaylar.some((o) => o.tip === 'bitti')).toBe(true);
    expect(hataSpy).toHaveBeenCalled();

    hataSpy.mockRestore();
  });

  it(
    'rate-limit uykusunda duraklat/devam sonrası limitBekliyor durumuna geri döner (BULGU 3)',
    async () => {
      const y = new IsYoneticisi();
      const durumlar: IsDurumu[] = [];
      y.dinle((o) => {
        if (o.tip === 'durum') durumlar.push(o.durum);
      });

      let duraklatildi = false;
      await y.baslat(
        ayarlar({
          satirlar: [SATIRLAR[0]],
          tarayici: sahteTarayici([
            { tip: 'rateLimit', mesaj: 'Try again in 2 minutes.' },
            { tip: 'gorsel' },
          ]),
          uyuMotoru: async (_ms, secenekler) => {
            if (secenekler.tik && !duraklatildi) {
              duraklatildi = true;
              y.duraklat();
              expect(y.bilgi().durum).toBe('duraklatildi');
              y.devam();
            }
          },
        }),
      );

      const duraklatIndex = durumlar.indexOf('duraklatildi');
      expect(duraklatIndex).toBeGreaterThan(-1);
      // devam() sonrası 'calisiyor' DEĞİL, duraklatma öncesindeki 'limitBekliyor'a dönmeli.
      expect(durumlar[duraklatIndex + 1]).toBe('limitBekliyor');
    },
    2000,
  );

  it('tüm satırlar atlandığında da sira güncellenir; satirBasladi çağrılmasa da (BULGU 4)', async () => {
    const y = new IsYoneticisi();

    const ozet = await y.baslat(ayarlar({ tamamlandiMi: () => true }));

    expect(ozet).toEqual({ basarili: 0, atlanan: SATIRLAR.length, basarisiz: 0 });
    const bilgi = y.bilgi();
    expect(bilgi.sira).toBe(SATIRLAR.length);
    expect(bilgi.toplam).toBe(SATIRLAR.length);
  });
});
