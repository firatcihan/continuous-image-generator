import { describe, expect, it, vi } from 'vitest';
import { IsYoneticisi } from '../src/is/isYoneticisi.js';
import type { IsDurumu, IsOlayi } from '../src/is/olaylar.js';
import type { Config, GorselSonucu, Satir, UretimSekmesi } from '../src/tipler.js';

const CONFIG: Config = {
  basePrompt: 'Bir kedi, {VARYASYON}',
  ciktiKlasoru: '/tmp/cikti',
  chromeProfil: '/tmp/profil',
  modelAdi: '',
  satirArasiBekleme: [0, 0],
  uretimZamanAsimiSn: 1,
  tekrarDenemeSayisi: 3,
  rateLimitVarsayilanBeklemeDk: 15,
  esZamanliSekme: 1,
};

const SATIRLAR: Satir[] = [
  { metin: 'karda', dosyaAdi: 'kedi_kar' },
  { metin: 'plajda', dosyaAdi: 'kedi_plaj' },
];

function sahteSekme(sonuclar: GorselSonucu[] = []): UretimSekmesi {
  const kuyruk = [...sonuclar];
  return {
    yeniSohbetAc: async () => {},
    oturumAcikMi: async () => true,
    aktifModelAdi: async () => 'GPT-5',
    gorselUret: async () => kuyruk.shift() ?? { tip: 'gorsel' },
    sonGorseliKaydet: async () => {},
  };
}

function ayarlar(ek: Partial<Parameters<IsYoneticisi['baslat']>[0]> = {}) {
  return {
    projeId: 'proje-1',
    config: CONFIG,
    satirlar: SATIRLAR,
    sekmeler: [sahteSekme()],
    tarayiciYenidenBaslat: async () => {},
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
        sekmeler: [sahteSekme([{ tip: 'rateLimit', mesaj: 'Try again in 2 minutes.' }, { tip: 'gorsel' }])],
        uyuMotoru: async (_ms, secenekler) => {
          secenekler.tik?.(120_000);
        },
      }),
    );

    expect(olaylar).toContainEqual({ tip: 'limitBekleniyor', kalanSn: 120 });
  });

  it('oturum düşünce kullaniciBekliyor durumunda kalır, kullaniciHazir ile sürer', async () => {
    let oturumAcik = false;
    const sekme = sahteSekme();
    sekme.oturumAcikMi = async () => oturumAcik;

    const y = new IsYoneticisi();
    const olaylar: IsOlayi[] = [];
    y.dinle((o) => {
      olaylar.push(o);
      if (o.tip === 'kullaniciGerekli') {
        oturumAcik = true;
        setTimeout(() => y.kullaniciHazir(), 0);
      }
    });

    await y.baslat(ayarlar({ satirlar: [SATIRLAR[0]], sekmeler: [sekme] }));

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

    // uyuMotoru'nun GERÇEKTEN çağrıldığını bekle. Belirli sayıda microtask'a
    // güvenmek kırılgandı: worker'ın uykuya ulaşmadan önce geçtiği `await`
    // sayısı değişince cozucu atanmamış oluyor ve iş sonsuza kadar asılıyordu.
    while (cozucu === undefined) await new Promise((coz) => setTimeout(coz, 0));

    cozucu();
    y.durdur();
    await calisma;
  });

  it('beklenmeyen hatada hata durumuna geçer ve hata olayı yayınlar', async () => {
    const sekme = sahteSekme();
    sekme.yeniSohbetAc = async () => {
      throw new Error('çöktü');
    };
    const tarayiciYenidenBaslat = async () => {
      throw new Error('yeniden başlatılamadı');
    };

    const y = new IsYoneticisi();
    const olaylar: IsOlayi[] = [];
    y.dinle((o) => olaylar.push(o));

    await expect(
      y.baslat(ayarlar({ sekmeler: [sekme], tarayiciYenidenBaslat })),
    ).rejects.toThrow();
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
        sekmeler: [sahteSekme([{ tip: 'rateLimit', mesaj: 'Try again in 2 minutes.' }])],
        uyuMotoru: async (_ms, secenekler) => {
          // sadece rate-limit uykusunda (tik tanımlı) durdur çağrısı gelir
          if (secenekler.tik) y.durdur();
        },
      }),
    );

    expect(durumlar).toEqual(['calisiyor', 'limitBekliyor', 'durduruldu']);
  });

  it('durdur sonrası gecikmiş kullaniciHazir çağrısı durumu sahte calisiyor yapmaz', async () => {
    const sekme = sahteSekme();
    sekme.oturumAcikMi = async () => false;

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

    await y.baslat(ayarlar({ satirlar: [SATIRLAR[0]], sekmeler: [sekme] }));

    expect(durumlar).toEqual(['calisiyor', 'kullaniciBekliyor', 'durduruldu']);
  });

  it(
    'kullaniciGerekli olayına senkron durdur() yanıtı kilitlenmeye yol açmaz (BULGU 1)',
    async () => {
      const sekme = sahteSekme();
      sekme.oturumAcikMi = async () => false;

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
        y.baslat(ayarlar({ satirlar: [SATIRLAR[0]], sekmeler: [sekme] })),
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
          sekmeler: [sahteSekme([
            { tip: 'rateLimit', mesaj: 'Try again in 2 minutes.' },
            { tip: 'gorsel' },
          ])],
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

  it('bilgi() biten sayısını ve uçuştaki dosyaları taşır', async () => {
    const y = new IsYoneticisi();
    const ucustaGoruntuler: string[][] = [];
    y.dinle((olay) => {
      if (olay.tip === 'satirBasladi') ucustaGoruntuler.push(y.bilgi().ucusta);
    });

    await y.baslat(ayarlar({ satirlar: [SATIRLAR[0], SATIRLAR[1]] }));

    // Satır başlarken o dosya uçuşta görünmeli
    expect(ucustaGoruntuler[0]).toContain(SATIRLAR[0].dosyaAdi);
    // İş bitince uçuş listesi boşalmalı
    expect(y.bilgi().ucusta).toEqual([]);
    expect(y.bilgi().biten).toBe(2);
  });

  it('satirBitti olayı dosyaAdi ve güncel özeti taşır', async () => {
    const y = new IsYoneticisi();
    const bitenler: Array<{ dosyaAdi: string; basarili: number }> = [];
    y.dinle((olay) => {
      if (olay.tip === 'satirBitti') {
        bitenler.push({ dosyaAdi: olay.dosyaAdi, basarili: olay.ozet.basarili });
      }
    });

    await y.baslat(ayarlar({ satirlar: [SATIRLAR[0]] }));

    expect(bitenler).toEqual([{ dosyaAdi: SATIRLAR[0].dosyaAdi, basarili: 1 }]);
  });
});

describe('paralel koordinasyon', () => {
  it('iki sekme aynı anda rate limit görürse yalnızca bir uyku yapılır', async () => {
    const uykular: number[] = [];
    const y = new IsYoneticisi();
    const limit = { tip: 'rateLimit', mesaj: 'Try again in 2 minutes.' } as const;

    // Uyku, İKİ sekme de limiti döndürene kadar tutulur. Aksi halde ilk sekmenin
    // uykusu ikinci sekme daha limiti görmeden biter; tespitler çakışmaz ve iki
    // ayrı uyku ÇIKMASI doğru davranış olurdu — test hiçbir şey kanıtlamazdı.
    let limitDonduren = 0;
    let ikisiDeGordu!: () => void;
    const cakisma = new Promise<void>((coz) => (ikisiDeGordu = coz));

    const limitliSekme = (): UretimSekmesi => {
      const s = sahteSekme();
      let ilk = true;
      s.gorselUret = async () => {
        if (!ilk) return { tip: 'gorsel' };
        ilk = false;
        limitDonduren++;
        // Makrotask: ikinci sekme uyku sarmalayıcısına GİRDİKTEN sonra serbest bırak
        if (limitDonduren === 2) setTimeout(ikisiDeGordu, 0);
        return limit;
      };
      return s;
    };

    await y.baslat(
      ayarlar({
        satirlar: [SATIRLAR[0], SATIRLAR[1]],
        sekmeler: [limitliSekme(), limitliSekme()],
        uyuMotoru: async (ms, secenekler) => {
          if (!secenekler.tik) return; // baslangic / satirArasi uykuları anında geçer
          uykular.push(ms);
          await cakisma;
        },
      }),
    );

    // İki sekme de limit gördü ama TekYurutuc tek uykuya bağladı
    expect(uykular.filter((ms) => ms === 2 * 60_000)).toHaveLength(1);
  });

  it('iki sekme aynı anda oturum kapalı görürse tek kullaniciGerekli olayı çıkar', async () => {
    const y = new IsYoneticisi();
    // Bayrak SEKME BAŞINA: paylaşılan tek bayrakta ikinci sekme oturumu zaten
    // açık görür ve testi vakumlaştırırdı — koruma olmasa bile tek olay çıkardı.
    const sekme = () => {
      const s = sahteSekme();
      let ilk = true;
      s.oturumAcikMi = async () => {
        if (!ilk) return true;
        ilk = false;
        return false;
      };
      return s;
    };

    const olaylar: string[] = [];
    y.dinle((olay) => {
      olaylar.push(olay.tip);
      if (olay.tip === 'kullaniciGerekli') setTimeout(() => y.kullaniciHazir(), 0);
    });

    await y.baslat(
      ayarlar({ satirlar: [SATIRLAR[0], SATIRLAR[1]], sekmeler: [sekme(), sekme()] }),
    );

    expect(olaylar.filter((t) => t === 'kullaniciGerekli')).toHaveLength(1);
  });

  it('iki sekme aynı anda çökerse tarayıcı bir kez yeniden başlatılır', async () => {
    const y = new IsYoneticisi();
    let yenidenBaslatSayisi = 0;

    // Yeniden başlatma, İKİ sekme de çökene kadar tutulur — aksi halde ilki
    // biter, ikinci çökme ayrı bir zamana düşer ve iki başlatma ÇIKMASI doğru
    // davranış olurdu.
    let cokenSayisi = 0;
    let ikisiDeCoktu!: () => void;
    const cakisma = new Promise<void>((coz) => (ikisiDeCoktu = coz));

    const sekmeler = [0, 1].map(() => {
      const s = sahteSekme();
      let ilkCagri = true;
      s.yeniSohbetAc = async () => {
        if (!ilkCagri) return;
        ilkCagri = false;
        cokenSayisi++;
        // Makrotask: ikinci işçi sarmalayıcıya GİRDİKTEN sonra serbest bırak
        if (cokenSayisi === 2) setTimeout(ikisiDeCoktu, 0);
        throw new Error('tarayıcı çöktü');
      };
      return s;
    });

    await y.baslat(
      ayarlar({
        satirlar: [SATIRLAR[0], SATIRLAR[1]],
        sekmeler,
        tarayiciYenidenBaslat: async () => {
          yenidenBaslatSayisi++;
          await cakisma;
        },
      }),
    );

    expect(yenidenBaslatSayisi).toBe(1);
  });
});
