import { describe, expect, it } from 'vitest';
import { geciciHataAlgila } from '../src/geciciHata.js';

describe('geciciHataAlgila', () => {
  it('ChatGPT Türkçe genel hata mesajını yakalar', () => {
    expect(geciciHataAlgila('Bir şeyler ters gitti. Lütfen tekrar deneyin.')).toBe(true);
  });

  it('İngilizce karşılığını yakalar', () => {
    expect(geciciHataAlgila('Something went wrong. Please try again.')).toBe(true);
  });

  it('diğer hata biçimlerini yakalar', () => {
    expect(geciciHataAlgila('An error occurred while generating')).toBe(true);
    expect(geciciHataAlgila('Bir hata oluştu')).toBe(true);
    expect(geciciHataAlgila('Görsel oluşturulamadı, yeniden deneyin')).toBe(true);
  });

  it('büyük/küçük harf ayrımı yapmaz', () => {
    expect(geciciHataAlgila('BİR ŞEYLER TERS GİTTİ')).toBe(true);
    expect(geciciHataAlgila('SOMETHING WENT WRONG')).toBe(true);
  });

  it('normal metinde yanlış pozitif üretmez', () => {
    expect(geciciHataAlgila('İşte istediğiniz görsel')).toBe(false);
    expect(geciciHataAlgila('Here is your image')).toBe(false);
    expect(geciciHataAlgila('')).toBe(false);
  });

  it('rate limit mesajını geçici hata saymaz (o ayrı ele alınır)', () => {
    expect(geciciHataAlgila("You've reached your image generation limit")).toBe(false);
    expect(geciciHataAlgila('Try again in 25 minutes.')).toBe(false);
  });

  it('içerik reddi mesajını geçici hata saymaz', () => {
    expect(geciciHataAlgila("I can't create that image — content policy")).toBe(false);
  });
});
