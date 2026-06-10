import { describe, expect, it } from 'vitest';
import { rastgeleSureMs, uyu } from '../src/bekleme.js';

describe('rastgeleSureMs', () => {
  it('aralık içinde milisaniye döndürür', () => {
    for (let i = 0; i < 100; i++) {
      const ms = rastgeleSureMs([5, 15]);
      expect(ms).toBeGreaterThanOrEqual(5000);
      expect(ms).toBeLessThanOrEqual(15000);
    }
  });

  it('min === maks ise sabit değer döndürür', () => {
    expect(rastgeleSureMs([3, 3])).toBe(3000);
  });
});

describe('uyu', () => {
  it('verilen süre kadar bekler', async () => {
    const baslangic = Date.now();
    await uyu(50);
    expect(Date.now() - baslangic).toBeGreaterThanOrEqual(45);
  });
});
