import { describe, expect, it } from 'vitest';
import { Kapi } from '../src/is/kapi.js';
import { uyuKesintili } from '../src/is/uyku.js';

/** Gerçek beklemeyen sahte uyku; çağrılan süreleri kaydeder. */
function sahteUyku() {
  const cagrilar: number[] = [];
  return {
    cagrilar,
    uyu: async (ms: number) => {
      cagrilar.push(ms);
    },
  };
}

describe('uyuKesintili', () => {
  it('süreyi adimMs dilimlerine böler', async () => {
    const s = sahteUyku();
    await uyuKesintili(3000, { adimMs: 1000, uyu: s.uyu });
    expect(s.cagrilar).toEqual([1000, 1000, 1000]);
  });

  it('son dilim kalan süre kadar olur', async () => {
    const s = sahteUyku();
    await uyuKesintili(2500, { adimMs: 1000, uyu: s.uyu });
    expect(s.cagrilar).toEqual([1000, 1000, 500]);
  });

  it('her dilim başında kalan süreyle tik çağırır', async () => {
    const s = sahteUyku();
    const kalanlar: number[] = [];
    await uyuKesintili(3000, { adimMs: 1000, uyu: s.uyu, tik: (k) => kalanlar.push(k) });
    expect(kalanlar).toEqual([3000, 2000, 1000]);
  });

  it('signal iptal edilince erken döner', async () => {
    const s = sahteUyku();
    const kontrolcu = new AbortController();
    let tikSayisi = 0;
    await uyuKesintili(60_000, {
      adimMs: 1000,
      uyu: s.uyu,
      signal: kontrolcu.signal,
      tik: () => {
        tikSayisi++;
        if (tikSayisi === 2) kontrolcu.abort();
      },
    });
    expect(s.cagrilar.length).toBeLessThan(5);
  });

  it('başlangıçta iptal edilmişse hiç uyumaz', async () => {
    const s = sahteUyku();
    const kontrolcu = new AbortController();
    kontrolcu.abort();
    await uyuKesintili(5000, { adimMs: 1000, uyu: s.uyu, signal: kontrolcu.signal });
    expect(s.cagrilar).toEqual([]);
  });

  it('kapı kapalıyken bekler, açılınca sürer', async () => {
    const s = sahteUyku();
    const kapi = new Kapi();
    kapi.kapat();

    let bitti = false;
    const calisma = uyuKesintili(1000, { adimMs: 1000, uyu: s.uyu, kapi }).then(() => {
      bitti = true;
    });

    await Promise.resolve();
    expect(bitti).toBe(false);

    kapi.ac();
    await calisma;
    expect(bitti).toBe(true);
  });

  it('sıfır veya negatif süre hemen döner', async () => {
    const s = sahteUyku();
    await uyuKesintili(0, { adimMs: 1000, uyu: s.uyu });
    expect(s.cagrilar).toEqual([]);
  });

  it(
    'adimMs sıfırsa sonsuz döngüye girmeden ilerler (BULGU 5)',
    async () => {
      const s = sahteUyku();
      await uyuKesintili(3, { adimMs: 0, uyu: s.uyu });
      expect(s.cagrilar.length).toBeGreaterThan(0);
      expect(s.cagrilar.reduce((a, b) => a + b, 0)).toBe(3);
    },
    1000,
  );

  it(
    'adimMs negatifse sonsuz döngüye girmeden ilerler (BULGU 5)',
    async () => {
      const s = sahteUyku();
      await uyuKesintili(3, { adimMs: -10, uyu: s.uyu });
      expect(s.cagrilar.length).toBeGreaterThan(0);
      expect(s.cagrilar.reduce((a, b) => a + b, 0)).toBe(3);
    },
    1000,
  );
});
