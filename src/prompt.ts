import type { Satir } from './tipler.js';

export const YER_TUTUCU = '{VARYASYON}';

export function promptOlustur(basePrompt: string, metin: string): string {
  if (!basePrompt.includes(YER_TUTUCU)) {
    throw new Error(`basePrompt içinde ${YER_TUTUCU} yer tutucusu bulunamadı`);
  }
  return basePrompt.replaceAll(YER_TUTUCU, metin);
}

export function yerTutucuVarMi(basePrompt: string): boolean {
  return basePrompt.includes(YER_TUTUCU);
}

/** İlk `adet` satırın gerçekte gönderilecek halini üretir. Yer tutucu yoksa boş dizi. */
export function onizlemeUret(basePrompt: string, satirlar: Satir[], adet = 3): string[] {
  if (!yerTutucuVarMi(basePrompt)) return [];
  return satirlar.slice(0, adet).map((satir) => promptOlustur(basePrompt, satir.metin));
}
