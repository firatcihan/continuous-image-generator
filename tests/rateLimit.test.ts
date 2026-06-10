import { describe, expect, it } from 'vitest';
import { beklemeSuresiAyikla, rateLimitAlgila } from '../src/rateLimit.js';

describe('rateLimitAlgila', () => {
  it('limit mesajlarını yakalar', () => {
    expect(rateLimitAlgila("You've reached your image generation limit.").limitli).toBe(true);
    expect(rateLimitAlgila('Too many requests. Please try again later.').limitli).toBe(true);
    expect(rateLimitAlgila('Görsel oluşturma limitin doldu.').limitli).toBe(true);
  });

  it('normal mesajları limit saymaz', () => {
    expect(rateLimitAlgila('İşte kedi görselin!').limitli).toBe(false);
    expect(rateLimitAlgila('').limitli).toBe(false);
  });

  it('mesajdaki süreyi dakika olarak çıkarır', () => {
    expect(rateLimitAlgila('Limit reached. Try again in 25 minutes.').beklemeDk).toBe(25);
    expect(rateLimitAlgila('Try again in 2 hours.').beklemeDk).toBe(120);
    expect(rateLimitAlgila('Try again in 1 hour 30 minutes.').beklemeDk).toBe(90);
  });

  it('süre yazmıyorsa beklemeDk undefined olur', () => {
    expect(rateLimitAlgila('Too many requests. Please try again later.').beklemeDk).toBeUndefined();
  });
});

describe('beklemeSuresiAyikla', () => {
  it('Türkçe süre ifadelerini de anlar', () => {
    expect(beklemeSuresiAyikla('45 dakika sonra tekrar dene')).toBe(45);
    expect(beklemeSuresiAyikla('1 saat sonra tekrar dene')).toBe(60);
  });
});
