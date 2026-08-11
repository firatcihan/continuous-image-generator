import { describe, expect, it, vi } from 'vitest';
import { Kapi } from '../src/is/kapi.js';
import type { Config, GorselSonucu, Satir, UretimTarayicisi } from '../src/tipler.js';
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
};

interface SahteSecenekler {
  sonuclar?: GorselSonucu[];
  oturum?: boolean[];
  model?: string;
}

function sahteTarayici(secenekler: SahteSecenekler = {}) {
  const sonuclar = [...(secenekler.sonuclar ?? [])];
  const oturumlar = [...(secenekler.oturum ?? [])];
  const cagrilar: string[] = [];
  const tarayici: UretimTarayicisi = {
    baslat: async () => {},
    yenidenBaslat: async () => {
      cagrilar.push('yenidenBaslat');
    },
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
    kapat: async () => {},
  };
  return { tarayici, cagrilar };
}

function bagimliliklar(
  tarayici: UretimTarayicisi,
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
    tarayici,
    logger: { bilgi: vi.fn(), uyari: vi.fn(), hata: vi.fn() } as never,
    kontrol: { signal: kontrolcu.signal, kapi: new Kapi() },
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
    const { tarayici, cagrilar } = sahteTarayici({ sonuclar: [{ tip: 'gorsel' }] });
    const b = bagimliliklar(tarayici);
    const ozet = await tumSatirlariIsle(b, [SATIR]);
    expect(ozet).toEqual({ basarili: 1, atlanan: 0, basarisiz: 0 });
    expect(cagrilar).toContain('kaydet:/tmp/cikti/kedi_kar.png');
  });

  it('çıktısı zaten var olan satırı atlar', async () => {
    const { tarayici, cagrilar } = sahteTarayici();
    const b = bagimliliklar(tarayici, { tamamlandiMi: () => true });
    const ozet = await tumSatirlariIsle(b, [SATIR]);
    expect(ozet).toEqual({ basarili: 0, atlanan: 1, basarisiz: 0 });
    expect(cagrilar).not.toContain('uret');
  });

  it('rate limit gelince mesajdaki süre kadar uyur ve aynı satırı tekrar dener', async () => {
    const { tarayici } = sahteTarayici({
      sonuclar: [{ tip: 'rateLimit', mesaj: 'Try again in 25 minutes.' }, { tip: 'gorsel' }],
    });
    const b = bagimliliklar(tarayici);
    const ozet = await tumSatirlariIsle(b, [SATIR]);
    expect(ozet.basarili).toBe(1);
    expect(b.beklemeler).toContainEqual({ ms: 25 * 60_000, sebep: 'rateLimit' });
  });

  it('süre belirtilmeyen rate limitte varsayılan süre uyur', async () => {
    const { tarayici } = sahteTarayici({
      sonuclar: [{ tip: 'rateLimit', mesaj: 'Too many requests. Please try again later.' }, { tip: 'gorsel' }],
    });
    const b = bagimliliklar(tarayici);
    await tumSatirlariIsle(b, [SATIR]);
    expect(b.beklemeler).toContainEqual({ ms: 15 * 60_000, sebep: 'rateLimit' });
  });

  it('zaman aşımı tekrar deneme sayısını aşınca başarısız yazar', async () => {
    const { tarayici, cagrilar } = sahteTarayici({
      sonuclar: [{ tip: 'zamanAsimi' }, { tip: 'zamanAsimi' }, { tip: 'zamanAsimi' }],
    });
    const b = bagimliliklar(tarayici);
    const ozet = await tumSatirlariIsle(b, [SATIR]);
    expect(ozet.basarisiz).toBe(1);
    expect(cagrilar.filter((c) => c === 'uret')).toHaveLength(3);
    expect(b.basarisizlar[0]).toContain('kedi_kar');
  });

  it('içerik reddinde tekrar denemeden başarısız yazar ve devam eder', async () => {
    const { tarayici, cagrilar } = sahteTarayici({
      sonuclar: [{ tip: 'red', mesaj: 'content policy' }, { tip: 'gorsel' }],
    });
    const b = bagimliliklar(tarayici);
    const ozet = await tumSatirlariIsle(b, [SATIR, { metin: 'plajda', dosyaAdi: 'plaj' }]);
    expect(ozet).toEqual({ basarili: 1, atlanan: 0, basarisiz: 1 });
    expect(b.basarisizlar[0]).toContain('içerik reddi');
    expect(cagrilar.filter((c) => c === 'uret')).toHaveLength(2);
  });

  it('oturum düşünce kullanıcıyı bekler, deneme hakkı yakmaz', async () => {
    const { tarayici } = sahteTarayici({ oturum: [false, true], sonuclar: [{ tip: 'gorsel' }] });
    const b = bagimliliklar(tarayici);
    const ozet = await tumSatirlariIsle(b, [SATIR]);
    expect(ozet.basarili).toBe(1);
    expect(b.onaylar).toHaveLength(1);
  });

  it('yanlış model seçiliyse kullanıcıyı bekler', async () => {
    const { tarayici } = sahteTarayici({ model: 'GPT-4o mini' });
    let modelDuzeltildi = false;
    const b = bagimliliklar(tarayici, {
      config: { ...CONFIG, modelAdi: 'GPT-5' },
      kullanicidanDevamBekle: async () => {
        modelDuzeltildi = true;
        (tarayici as { aktifModelAdi: () => Promise<string> }).aktifModelAdi = async () => 'GPT-5';
      },
    });
    const ozet = await tumSatirlariIsle(b, [SATIR]);
    expect(modelDuzeltildi).toBe(true);
    expect(ozet.basarili).toBe(1);
  });

  it('tarayıcı hatasında yeniden başlatır ve tekrar dener', async () => {
    const { tarayici, cagrilar } = sahteTarayici({ sonuclar: [{ tip: 'gorsel' }] });
    let ilkCagri = true;
    const orijinalYeniSohbet = tarayici.yeniSohbetAc;
    tarayici.yeniSohbetAc = async () => {
      if (ilkCagri) {
        ilkCagri = false;
        throw new Error('tarayıcı çöktü');
      }
      await orijinalYeniSohbet();
    };
    const b = bagimliliklar(tarayici);
    const ozet = await tumSatirlariIsle(b, [SATIR]);
    expect(ozet.basarili).toBe(1);
    expect(cagrilar).toContain('yenidenBaslat');
  });

  it('durdurulunca kalan satırları işlemez', async () => {
    const { tarayici, cagrilar } = sahteTarayici();
    const b = bagimliliklar(tarayici);
    b.kontrolcu.abort();
    const ozet = await tumSatirlariIsle(b, [SATIR, { metin: 'plajda', dosyaAdi: 'plaj' }]);
    expect(ozet).toEqual({ basarili: 0, atlanan: 0, basarisiz: 0 });
    expect(cagrilar).not.toContain('uret');
  });

  it('ilk satırdan sonra durdurulunca ikinciyi işlemez', async () => {
    const { tarayici, cagrilar } = sahteTarayici({ sonuclar: [{ tip: 'gorsel' }] });
    const b = bagimliliklar(tarayici, {
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
    const { tarayici, cagrilar } = sahteTarayici({ sonuclar: [{ tip: 'gorsel' }] });
    const kapi = new Kapi();
    const kontrolcu = new AbortController();
    const b = bagimliliklar(tarayici, { kontrol: { signal: kontrolcu.signal, kapi } });
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
    const { tarayici } = sahteTarayici({ sonuclar: [{ tip: 'gorsel' }] });
    const b = bagimliliklar(tarayici);
    await tumSatirlariIsle(b, [SATIR]);
    expect(b.olaylar).toEqual(['basladi:1:kedi_kar', 'bitti:1:basarili']);
  });

  it('atlanan satır için atlandı olayı yayınlar', async () => {
    const { tarayici } = sahteTarayici();
    const b = bagimliliklar(tarayici, { tamamlandiMi: () => true });
    await tumSatirlariIsle(b, [SATIR]);
    expect(b.olaylar).toEqual(['bitti:1:atlandi']);
  });

  it('satır arası beklemeyi satirArasi sebebiyle yapar', async () => {
    const { tarayici } = sahteTarayici({ sonuclar: [{ tip: 'gorsel' }] });
    const b = bagimliliklar(tarayici, { config: { ...CONFIG, satirArasiBekleme: [2, 2] } });
    await tumSatirlariIsle(b, [SATIR]);
    expect(b.beklemeler).toContainEqual({ ms: 2000, sebep: 'satirArasi' });
  });
  it('geçici hata gelince kısa bekleyip tekrar dener, sonunda başarılı olur', async () => {
    const { tarayici, cagrilar } = sahteTarayici({
      sonuclar: [{ tip: 'geciciHata', mesaj: 'Bir şeyler ters gitti.' }, { tip: 'gorsel' }],
    });
    const b = bagimliliklar(tarayici);
    const ozet = await tumSatirlariIsle(b, [SATIR]);
    expect(ozet.basarili).toBe(1);
    expect(cagrilar.filter((c) => c === 'uret')).toHaveLength(2);
    expect(b.beklemeler.some((x) => x.sebep === 'geciciHata')).toBe(true);
  });

  it('geçici hata deneme hakkı yakar; sürekli gelirse başarısız yazar', async () => {
    const { tarayici, cagrilar } = sahteTarayici({
      sonuclar: [
        { tip: 'geciciHata', mesaj: 'Bir şeyler ters gitti.' },
        { tip: 'geciciHata', mesaj: 'Bir şeyler ters gitti.' },
        { tip: 'geciciHata', mesaj: 'Bir şeyler ters gitti.' },
      ],
    });
    const b = bagimliliklar(tarayici);
    const ozet = await tumSatirlariIsle(b, [SATIR]);
    expect(ozet.basarisiz).toBe(1);
    expect(cagrilar.filter((c) => c === 'uret')).toHaveLength(3);
    expect(b.basarisizlar[0]).toContain('geçici hata');
  });

  it('geçici hatada rate limit beklemesi KADAR uzun beklemez', async () => {
    const { tarayici } = sahteTarayici({
      sonuclar: [{ tip: 'geciciHata', mesaj: 'Bir şeyler ters gitti.' }, { tip: 'gorsel' }],
    });
    const b = bagimliliklar(tarayici);
    await tumSatirlariIsle(b, [SATIR]);
    const geciciBekleme = b.beklemeler.find((x) => x.sebep === 'geciciHata');
    expect(geciciBekleme!.ms).toBeLessThan(60_000);
  });
});
