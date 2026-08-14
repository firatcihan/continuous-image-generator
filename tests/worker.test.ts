import { describe, expect, it, vi } from 'vitest';
import { Kapi, type IsKapilari } from '../src/is/kapi.js';
import type { Config, GorselSonucu, Satir, UretimSekmesi } from '../src/tipler.js';
import { tumSatirlariIsle, type UykuSebebi, type WorkerBagimliliklari } from '../src/worker.js';

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

interface SahteSecenekler {
  sonuclar?: GorselSonucu[];
  oturum?: boolean[];
  model?: string;
}

function sahteSekmeler(secenekler: SahteSecenekler = {}, adet = 1) {
  // Diziler sekmeler arasında PAYLAŞILIR: testler sonuç sırasını kurgulayarak
  // hangi sekmenin ne alacağını belirleyebilsin.
  const sonuclar = [...(secenekler.sonuclar ?? [])];
  const oturumlar = [...(secenekler.oturum ?? [])];
  const cagrilar: string[] = [];
  const yenidenBaslat = async () => {
    cagrilar.push('yenidenBaslat');
  };

  const sekmeler: UretimSekmesi[] = Array.from({ length: adet }, () => ({
    yeniSohbetAc: async () => {
      cagrilar.push('yeniSohbet');
    },
    oturumAcikMi: async () => (oturumlar.length > 0 ? oturumlar.shift()! : true),
    aktifModelAdi: async () => secenekler.model ?? 'GPT-5',
    gorselUret: async () => {
      cagrilar.push('uret');
      return sonuclar.shift() ?? { tip: 'gorsel' };
    },
    sonGorseliKaydet: async (yol: string) => {
      cagrilar.push(`kaydet:${yol}`);
    },
  }));

  return { sekmeler, cagrilar, yenidenBaslat };
}

function bagimliliklar(
  sekmeler: UretimSekmesi[],
  tarayiciYenidenBaslat: () => Promise<void>,
  ek: Partial<WorkerBagimliliklari> = {},
): WorkerBagimliliklari & {
  basarisizlar: string[];
  beklemeler: Array<{ ms: number; sebep: UykuSebebi }>;
  onaylar: string[];
  olaylar: string[];
  kontrolcu: AbortController;
} {
  const basarisizlar: string[] = [];
  const beklemeler: Array<{ ms: number; sebep: UykuSebebi }> = [];
  const onaylar: string[] = [];
  const olaylar: string[] = [];
  const kontrolcu = new AbortController();
  return {
    config: CONFIG,
    sekmeler,
    tarayiciYenidenBaslat,
    logger: { bilgi: vi.fn(), uyari: vi.fn(), hata: vi.fn() } as never,
    kontrol: { signal: kontrolcu.signal, kapi: new Kapi() },
    kapilar: { limit: new Kapi(), kullanici: new Kapi(), yenidenBaslatma: new Kapi() },
    uyu: async (ms: number, sebep: UykuSebebi) => {
      beklemeler.push({ ms, sebep });
    },
    tamamlandiMi: () => false,
    basarisizKaydet: (satir: Satir, sebep: string) => {
      basarisizlar.push(`${satir.dosyaAdi}: ${sebep}`);
    },
    kullanicidanDevamBekle: async (mesaj: string) => {
      onaylar.push(mesaj);
    },
    satirBasladi: (sira, _toplam, satir) => olaylar.push(`basladi:${sira}:${satir.dosyaAdi}`),
    satirBitti: (sira, sonuc) => olaylar.push(`bitti:${sira}:${sonuc}`),
    basarisizlar,
    beklemeler,
    onaylar,
    olaylar,
    kontrolcu,
    ...ek,
  };
}

const SATIR: Satir = { metin: 'karda', dosyaAdi: 'kedi_kar' };

describe('tumSatirlariIsle', () => {
  it('başarılı üretimde görseli doğru yola kaydeder', async () => {
    const { sekmeler, cagrilar, yenidenBaslat } = sahteSekmeler({ sonuclar: [{ tip: 'gorsel' }] });
    const b = bagimliliklar(sekmeler, yenidenBaslat);
    const ozet = await tumSatirlariIsle(b, [SATIR]);
    expect(ozet).toEqual({ basarili: 1, atlanan: 0, basarisiz: 0 });
    expect(cagrilar).toContain('kaydet:/tmp/cikti/kedi_kar.png');
  });

  it('çıktısı zaten var olan satırı atlar', async () => {
    const { sekmeler, cagrilar, yenidenBaslat } = sahteSekmeler();
    const b = bagimliliklar(sekmeler, yenidenBaslat, { tamamlandiMi: () => true });
    const ozet = await tumSatirlariIsle(b, [SATIR]);
    expect(ozet).toEqual({ basarili: 0, atlanan: 1, basarisiz: 0 });
    expect(cagrilar).not.toContain('uret');
  });

  it('rate limit gelince mesajdaki süre kadar uyur ve aynı satırı tekrar dener', async () => {
    const { sekmeler, yenidenBaslat } = sahteSekmeler({
      sonuclar: [{ tip: 'rateLimit', mesaj: 'Try again in 25 minutes.' }, { tip: 'gorsel' }],
    });
    const b = bagimliliklar(sekmeler, yenidenBaslat);
    const ozet = await tumSatirlariIsle(b, [SATIR]);
    expect(ozet.basarili).toBe(1);
    expect(b.beklemeler).toContainEqual({ ms: 25 * 60_000, sebep: 'rateLimit' });
  });

  it('süre belirtilmeyen rate limitte varsayılan süre uyur', async () => {
    const { sekmeler, yenidenBaslat } = sahteSekmeler({
      sonuclar: [{ tip: 'rateLimit', mesaj: 'Too many requests. Please try again later.' }, { tip: 'gorsel' }],
    });
    const b = bagimliliklar(sekmeler, yenidenBaslat);
    await tumSatirlariIsle(b, [SATIR]);
    expect(b.beklemeler).toContainEqual({ ms: 15 * 60_000, sebep: 'rateLimit' });
  });

  it('zaman aşımı tekrar deneme sayısını aşınca başarısız yazar', async () => {
    const { sekmeler, cagrilar, yenidenBaslat } = sahteSekmeler({
      sonuclar: [{ tip: 'zamanAsimi' }, { tip: 'zamanAsimi' }, { tip: 'zamanAsimi' }],
    });
    const b = bagimliliklar(sekmeler, yenidenBaslat);
    const ozet = await tumSatirlariIsle(b, [SATIR]);
    expect(ozet.basarisiz).toBe(1);
    expect(cagrilar.filter((c) => c === 'uret')).toHaveLength(3);
    expect(b.basarisizlar[0]).toContain('kedi_kar');
  });

  it('içerik reddinde tekrar denemeden başarısız yazar ve devam eder', async () => {
    const { sekmeler, cagrilar, yenidenBaslat } = sahteSekmeler({
      sonuclar: [{ tip: 'red', mesaj: 'content policy' }, { tip: 'gorsel' }],
    });
    const b = bagimliliklar(sekmeler, yenidenBaslat);
    const ozet = await tumSatirlariIsle(b, [SATIR, { metin: 'plajda', dosyaAdi: 'plaj' }]);
    expect(ozet).toEqual({ basarili: 1, atlanan: 0, basarisiz: 1 });
    expect(b.basarisizlar[0]).toContain('içerik reddi');
    expect(cagrilar.filter((c) => c === 'uret')).toHaveLength(2);
  });

  it('oturum düşünce kullanıcıyı bekler, deneme hakkı yakmaz', async () => {
    const { sekmeler, yenidenBaslat } = sahteSekmeler({ oturum: [false, true], sonuclar: [{ tip: 'gorsel' }] });
    const b = bagimliliklar(sekmeler, yenidenBaslat);
    const ozet = await tumSatirlariIsle(b, [SATIR]);
    expect(ozet.basarili).toBe(1);
    expect(b.onaylar).toHaveLength(1);
  });

  it('yanlış model seçiliyse kullanıcıyı bekler', async () => {
    const { sekmeler, yenidenBaslat } = sahteSekmeler({ model: 'GPT-4o mini' });
    let modelDuzeltildi = false;
    const b = bagimliliklar(sekmeler, yenidenBaslat, {
      config: { ...CONFIG, modelAdi: 'GPT-5' },
      kullanicidanDevamBekle: async () => {
        modelDuzeltildi = true;
        (sekmeler[0] as { aktifModelAdi: () => Promise<string> }).aktifModelAdi = async () => 'GPT-5';
      },
    });
    const ozet = await tumSatirlariIsle(b, [SATIR]);
    expect(modelDuzeltildi).toBe(true);
    expect(ozet.basarili).toBe(1);
  });

  it('tarayıcı hatasında yeniden başlatır ve tekrar dener', async () => {
    const { sekmeler, cagrilar, yenidenBaslat } = sahteSekmeler({ sonuclar: [{ tip: 'gorsel' }] });
    let ilkCagri = true;
    const orijinalYeniSohbet = sekmeler[0].yeniSohbetAc;
    sekmeler[0].yeniSohbetAc = async () => {
      if (ilkCagri) {
        ilkCagri = false;
        throw new Error('tarayıcı çöktü');
      }
      await orijinalYeniSohbet();
    };
    const b = bagimliliklar(sekmeler, yenidenBaslat);
    const ozet = await tumSatirlariIsle(b, [SATIR]);
    expect(ozet.basarili).toBe(1);
    expect(cagrilar).toContain('yenidenBaslat');
  });

  it('başka işçi yeniden başlatırken düşen sekme deneme hakkı yakmaz', async () => {
    const { sekmeler, cagrilar, yenidenBaslat } = sahteSekmeler({ sonuclar: [{ tip: 'gorsel' }] });
    const kapilar: IsKapilari = {
      limit: new Kapi(),
      kullanici: new Kapi(),
      yenidenBaslatma: new Kapi(),
    };

    // Gerçek senaryo: başka bir işçi tarayıcıyı yeniden başlatmaya başlamış,
    // context bu işçinin altından çekilmiş. Hata bu satırın suçu değil.
    let ilkCagri = true;
    const orijinalYeniSohbet = sekmeler[0].yeniSohbetAc;
    sekmeler[0].yeniSohbetAc = async () => {
      if (ilkCagri) {
        ilkCagri = false;
        kapilar.yenidenBaslatma.kapat();
        setTimeout(() => kapilar.yenidenBaslatma.ac(), 5);
        throw new Error('sekme 0 hazır değil; önce sekmeleriHazirla() çağrılmalı');
      }
      await orijinalYeniSohbet();
    };

    const b = bagimliliklar(sekmeler, yenidenBaslat, { kapilar, config: { ...CONFIG, tekrarDenemeSayisi: 1 } });
    const ozet = await tumSatirlariIsle(b, [SATIR]);

    // tekrarDenemeSayisi=1: hak yakılsaydı satır tek denemede başarısız olurdu.
    expect(ozet).toEqual({ basarili: 1, atlanan: 0, basarisiz: 0 });
    // İkinci bir yeniden başlatma da tetiklenmemeli — süreni beklemek yeter.
    expect(cagrilar).not.toContain('yenidenBaslat');
  });

  it('durdurulunca kalan satırları işlemez', async () => {
    const { sekmeler, cagrilar, yenidenBaslat } = sahteSekmeler();
    const b = bagimliliklar(sekmeler, yenidenBaslat);
    b.kontrolcu.abort();
    const ozet = await tumSatirlariIsle(b, [SATIR, { metin: 'plajda', dosyaAdi: 'plaj' }]);
    expect(ozet).toEqual({ basarili: 0, atlanan: 0, basarisiz: 0 });
    expect(cagrilar).not.toContain('uret');
  });

  it('ilk satırdan sonra durdurulunca ikinciyi işlemez', async () => {
    const { sekmeler, cagrilar, yenidenBaslat } = sahteSekmeler({ sonuclar: [{ tip: 'gorsel' }] });
    const b = bagimliliklar(sekmeler, yenidenBaslat, {
      satirBitti: () => {},
    });
    const orijinalUyu = b.uyu;
    b.uyu = async (ms, sebep) => {
      b.kontrolcu.abort();
      await orijinalUyu(ms, sebep);
    };
    const ozet = await tumSatirlariIsle(b, [SATIR, { metin: 'plajda', dosyaAdi: 'plaj' }]);
    expect(ozet.basarili).toBe(1);
    expect(cagrilar.filter((c) => c === 'uret')).toHaveLength(1);
  });

  it('duraklatılmışken satır başlatmaz, devam edince sürer', async () => {
    const { sekmeler, cagrilar, yenidenBaslat } = sahteSekmeler({ sonuclar: [{ tip: 'gorsel' }] });
    const kapi = new Kapi();
    const kontrolcu = new AbortController();
    const b = bagimliliklar(sekmeler, yenidenBaslat, { kontrol: { signal: kontrolcu.signal, kapi } });
    kapi.kapat();

    let bitti = false;
    const calisma = tumSatirlariIsle(b, [SATIR]).then(() => {
      bitti = true;
    });

    await Promise.resolve();
    expect(cagrilar).not.toContain('uret');
    expect(bitti).toBe(false);

    kapi.ac();
    await calisma;
    expect(cagrilar).toContain('uret');
  });

  it('satır başladı ve bitti olaylarını sırayla yayınlar', async () => {
    const { sekmeler, yenidenBaslat } = sahteSekmeler({ sonuclar: [{ tip: 'gorsel' }] });
    const b = bagimliliklar(sekmeler, yenidenBaslat);
    await tumSatirlariIsle(b, [SATIR]);
    expect(b.olaylar).toEqual(['basladi:1:kedi_kar', 'bitti:1:basarili']);
  });

  it('atlanan satır için atlandı olayı yayınlar', async () => {
    const { sekmeler, yenidenBaslat } = sahteSekmeler();
    const b = bagimliliklar(sekmeler, yenidenBaslat, { tamamlandiMi: () => true });
    await tumSatirlariIsle(b, [SATIR]);
    expect(b.olaylar).toEqual(['bitti:1:atlandi']);
  });

  it('satır arası beklemeyi satirArasi sebebiyle yapar', async () => {
    const { sekmeler, yenidenBaslat } = sahteSekmeler({ sonuclar: [{ tip: 'gorsel' }] });
    const b = bagimliliklar(sekmeler, yenidenBaslat, { config: { ...CONFIG, satirArasiBekleme: [2, 2] } });
    await tumSatirlariIsle(b, [SATIR]);
    expect(b.beklemeler).toContainEqual({ ms: 2000, sebep: 'satirArasi' });
  });
  it('geçici hata gelince kısa bekleyip tekrar dener, sonunda başarılı olur', async () => {
    const { sekmeler, cagrilar, yenidenBaslat } = sahteSekmeler({
      sonuclar: [{ tip: 'geciciHata', mesaj: 'Bir şeyler ters gitti.' }, { tip: 'gorsel' }],
    });
    const b = bagimliliklar(sekmeler, yenidenBaslat);
    const ozet = await tumSatirlariIsle(b, [SATIR]);
    expect(ozet.basarili).toBe(1);
    expect(cagrilar.filter((c) => c === 'uret')).toHaveLength(2);
    expect(b.beklemeler.some((x) => x.sebep === 'geciciHata')).toBe(true);
  });

  it('geçici hata deneme hakkı yakar; sürekli gelirse başarısız yazar', async () => {
    const { sekmeler, cagrilar, yenidenBaslat } = sahteSekmeler({
      sonuclar: [
        { tip: 'geciciHata', mesaj: 'Bir şeyler ters gitti.' },
        { tip: 'geciciHata', mesaj: 'Bir şeyler ters gitti.' },
        { tip: 'geciciHata', mesaj: 'Bir şeyler ters gitti.' },
      ],
    });
    const b = bagimliliklar(sekmeler, yenidenBaslat);
    const ozet = await tumSatirlariIsle(b, [SATIR]);
    expect(ozet.basarisiz).toBe(1);
    expect(cagrilar.filter((c) => c === 'uret')).toHaveLength(3);
    expect(b.basarisizlar[0]).toContain('geçici hata');
  });

  it('geçici hatada rate limit beklemesi KADAR uzun beklemez', async () => {
    const { sekmeler, yenidenBaslat } = sahteSekmeler({
      sonuclar: [{ tip: 'geciciHata', mesaj: 'Bir şeyler ters gitti.' }, { tip: 'gorsel' }],
    });
    const b = bagimliliklar(sekmeler, yenidenBaslat);
    await tumSatirlariIsle(b, [SATIR]);
    const geciciBekleme = b.beklemeler.find((x) => x.sebep === 'geciciHata');
    expect(geciciBekleme!.ms).toBeLessThan(60_000);
  });

  it('N=3 iken üç satır AYNI ANDA uçuşta olur', async () => {
    // Asıl paralellik iddiası: üç sekme de üretimi başlatmadan hiçbiri bitmesin.
    let uctakiler = 0;
    let enYuksekUcus = 0;
    const birak: Array<() => void> = [];

    const sekmeler: UretimSekmesi[] = Array.from({ length: 3 }, () => ({
      yeniSohbetAc: async () => {},
      oturumAcikMi: async () => true,
      aktifModelAdi: async () => 'GPT-5',
      gorselUret: async () => {
        uctakiler++;
        enYuksekUcus = Math.max(enYuksekUcus, uctakiler);
        await new Promise<void>((coz) => birak.push(coz));
        uctakiler--;
        return { tip: 'gorsel' } as const;
      },
      sonGorseliKaydet: async () => {},
    }));

    const b = bagimliliklar(sekmeler, async () => {});
    const calisma = tumSatirlariIsle(b, [
      SATIR,
      { metin: 'plajda', dosyaAdi: 'plaj' },
      { metin: 'dağda', dosyaAdi: 'dag' },
    ]);

    // Üç sekmenin de gorselUret'e girmesini bekle
    while (birak.length < 3) await new Promise((coz) => setTimeout(coz, 0));
    expect(enYuksekUcus).toBe(3);

    for (const coz of birak) coz();
    await calisma;
  });

  it('N=3 iken 7 satırın her birini tam bir kez işler', async () => {
    const { sekmeler, cagrilar, yenidenBaslat } = sahteSekmeler({}, 3);
    const b = bagimliliklar(sekmeler, yenidenBaslat);
    const satirlar: Satir[] = Array.from({ length: 7 }, (_, i) => ({
      metin: `varyasyon ${i}`,
      dosyaAdi: `dosya_${i}`,
    }));

    const ozet = await tumSatirlariIsle(b, satirlar);

    expect(ozet).toEqual({ basarili: 7, atlanan: 0, basarisiz: 0 });
    expect(cagrilar.filter((c) => c === 'uret')).toHaveLength(7);
    const kaydedilen = cagrilar.filter((c) => c.startsWith('kaydet:'));
    expect(new Set(kaydedilen).size).toBe(7);
  });

  it('N=3 iken her satır için tam bir başladı ve bir bitti olayı yayınlar', async () => {
    const { sekmeler, yenidenBaslat } = sahteSekmeler({}, 3);
    const b = bagimliliklar(sekmeler, yenidenBaslat);
    const satirlar: Satir[] = Array.from({ length: 6 }, (_, i) => ({
      metin: `varyasyon ${i}`,
      dosyaAdi: `dosya_${i}`,
    }));

    await tumSatirlariIsle(b, satirlar);

    for (let sira = 1; sira <= 6; sira++) {
      expect(b.olaylar.filter((o) => o.startsWith(`basladi:${sira}:`))).toHaveLength(1);
      expect(b.olaylar.filter((o) => o.startsWith(`bitti:${sira}:`))).toHaveLength(1);
    }
  });

  it('satır sayısı sekme sayısından azsa fazla işçi boşta çıkar', async () => {
    const { sekmeler, cagrilar, yenidenBaslat } = sahteSekmeler({}, 4);
    const b = bagimliliklar(sekmeler, yenidenBaslat);

    const ozet = await tumSatirlariIsle(b, [SATIR]);

    expect(ozet.basarili).toBe(1);
    expect(cagrilar.filter((c) => c === 'uret')).toHaveLength(1);
  });

  it('işçi i, ilk satırından önce i × satırArası kadar baslangic uykusu yapar', async () => {
    // min = maks: rastgeleSureMs deterministik olsun
    const { sekmeler, yenidenBaslat } = sahteSekmeler({}, 3);
    const b = bagimliliklar(sekmeler, yenidenBaslat, {
      config: { ...CONFIG, satirArasiBekleme: [10, 10] },
    });

    await tumSatirlariIsle(b, [
      SATIR,
      { metin: 'plajda', dosyaAdi: 'plaj' },
      { metin: 'dağda', dosyaAdi: 'dag' },
    ]);

    const kaymalar = b.beklemeler.filter((x) => x.sebep === 'baslangic').map((x) => x.ms);
    // İşçi 0 hiç kaymaz (0 ms uyku yapılmaz), işçi 1 ve 2 kayar
    expect(kaymalar.sort((a, c) => a - c)).toEqual([10_000, 20_000]);
  });

  for (const ad of ['limit', 'kullanici', 'yenidenBaslatma'] as const) {
    it(`${ad} kapısı kapalıyken yeni satır çekmez, açılınca sürer`, async () => {
      const { sekmeler, cagrilar, yenidenBaslat } = sahteSekmeler({}, 1);
      const kapilar: IsKapilari = {
        limit: new Kapi(),
        kullanici: new Kapi(),
        yenidenBaslatma: new Kapi(),
      };
      const b = bagimliliklar(sekmeler, yenidenBaslat, { kapilar });
      kapilar[ad].kapat();

      let bitti = false;
      const calisma = tumSatirlariIsle(b, [SATIR]).then(() => {
        bitti = true;
      });

      // Gerçek makrotask beklemesi şart: `await Promise.resolve()` yalnızca tek
      // microtask ilerletir, worker ise `uret`e ulaşana kadar birkaç tick geçirir
      // — kapı olmasa bile test o anda henüz 'uret' görmezdi (sahte yeşil).
      await new Promise((coz) => setTimeout(coz, 5));
      expect(cagrilar).not.toContain('uret');
      expect(bitti).toBe(false);

      kapilar[ad].ac();
      await calisma;
      expect(cagrilar).toContain('uret');
    });
  }
});
