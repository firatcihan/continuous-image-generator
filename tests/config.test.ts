import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configYukle } from '../src/config.js';

function configDosyasiYaz(icerik: unknown): string {
  const yol = join(mkdtempSync(join(tmpdir(), 'cfg-')), 'config.json');
  writeFileSync(yol, JSON.stringify(icerik), 'utf-8');
  return yol;
}

const GECERLI = {
  basePrompt: 'Bir kedi, {VARYASYON}',
  ciktiKlasoru: './gorseller',
  chromeProfil: './chrome_profil',
};

describe('configYukle', () => {
  it('zorunlu alanları okur ve varsayılanları doldurur', () => {
    const config = configYukle(configDosyasiYaz(GECERLI));
    expect(config.basePrompt).toBe('Bir kedi, {VARYASYON}');
    expect(config.satirArasiBekleme).toEqual([5, 15]);
    expect(config.uretimZamanAsimiSn).toBe(180);
    expect(config.tekrarDenemeSayisi).toBe(3);
    expect(config.rateLimitVarsayilanBeklemeDk).toBe(15);
    expect(config.modelAdi).toBe('');
  });

  it('dosyadaki değerler varsayılanları ezer', () => {
    const config = configYukle(configDosyasiYaz({ ...GECERLI, uretimZamanAsimiSn: 60, modelAdi: 'GPT-5' }));
    expect(config.uretimZamanAsimiSn).toBe(60);
    expect(config.modelAdi).toBe('GPT-5');
  });

  it('zorunlu alan eksikse hata fırlatır', () => {
    expect(() => configYukle(configDosyasiYaz({ basePrompt: 'x' }))).toThrow('ciktiKlasoru');
  });

  it('satirArasiBekleme bozuksa hata fırlatır', () => {
    expect(() => configYukle(configDosyasiYaz({ ...GECERLI, satirArasiBekleme: [15, 5] }))).toThrow('satirArasiBekleme');
  });

  it('pozitif olmayan sayılar için hata fırlatır', () => {
    expect(() => configYukle(configDosyasiYaz({ ...GECERLI, tekrarDenemeSayisi: 0 }))).toThrow('tekrarDenemeSayisi');
  });

  it('dosya yoksa anlaşılır hata verir', () => {
    expect(() => configYukle('/olmayan/config.json')).toThrow('okunamadı');
  });
});
