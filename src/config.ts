import { readFileSync } from 'node:fs';
import type { Config } from './tipler.js';

const VARSAYILANLAR = {
  modelAdi: '',
  satirArasiBekleme: [5, 15] as [number, number],
  uretimZamanAsimiSn: 180,
  tekrarDenemeSayisi: 3,
  rateLimitVarsayilanBeklemeDk: 15,
};

export function configYukle(yol: string): Config {
  let ham: Record<string, unknown>;
  try {
    ham = JSON.parse(readFileSync(yol, 'utf-8'));
  } catch (hata) {
    throw new Error(`config dosyası okunamadı (${yol}): ${(hata as Error).message}`);
  }

  for (const alan of ['basePrompt', 'ciktiKlasoru', 'chromeProfil'] as const) {
    if (typeof ham[alan] !== 'string' || (ham[alan] as string).trim() === '') {
      throw new Error(`config.json: "${alan}" alanı zorunlu ve boş olmayan bir metin olmalı`);
    }
  }

  const config = { ...VARSAYILANLAR, ...ham } as Config;

  const bekleme = config.satirArasiBekleme;
  if (
    !Array.isArray(bekleme) ||
    bekleme.length !== 2 ||
    bekleme.some((sn) => typeof sn !== 'number' || sn < 0) ||
    bekleme[0] > bekleme[1]
  ) {
    throw new Error('config.json: "satirArasiBekleme" [min, maks] saniye olmalı (min <= maks)');
  }

  for (const alan of ['uretimZamanAsimiSn', 'tekrarDenemeSayisi', 'rateLimitVarsayilanBeklemeDk'] as const) {
    if (typeof config[alan] !== 'number' || config[alan] <= 0) {
      throw new Error(`config.json: "${alan}" pozitif bir sayı olmalı`);
    }
  }

  return config;
}
