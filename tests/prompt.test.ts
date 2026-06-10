import { describe, expect, it } from 'vitest';
import { promptOlustur } from '../src/prompt.js';

describe('promptOlustur', () => {
  it('{VARYASYON} yer tutucusunu metinle değiştirir', () => {
    expect(promptOlustur('Bir kedi, {VARYASYON}, detaylı', 'karda')).toBe('Bir kedi, karda, detaylı');
  });

  it('birden çok {VARYASYON} geçtiyse hepsini değiştirir', () => {
    expect(promptOlustur('{VARYASYON} ve {VARYASYON}', 'x')).toBe('x ve x');
  });

  it('yer tutucu yoksa hata fırlatır', () => {
    expect(() => promptOlustur('yer tutucu yok', 'x')).toThrow('{VARYASYON}');
  });
});
