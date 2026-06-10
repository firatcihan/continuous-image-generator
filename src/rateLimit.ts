export interface RateLimitBilgisi {
  limitli: boolean;
  beklemeDk?: number;
}

const LIMIT_KALIPLARI = [
  /you('|’)ve reached (your|our|the)?\s*.*limit/i,
  /you('|’)ve hit (your|the)?\s*.*limit/i,
  /image generation limit/i,
  /too many requests/i,
  /try again (in|after|later)/i,
  /limit(in)? (doldu|aşıldı)/i,
  /sonra tekrar dene/i,
];

export function rateLimitAlgila(metin: string): RateLimitBilgisi {
  if (!LIMIT_KALIPLARI.some((kalip) => kalip.test(metin))) {
    return { limitli: false };
  }
  return { limitli: true, beklemeDk: beklemeSuresiAyikla(metin) };
}

export function beklemeSuresiAyikla(metin: string): number | undefined {
  const saat = metin.match(/(\d+)\s*(hours?|saat)/i);
  const dakika = metin.match(/(\d+)\s*(minutes?|mins?\b|dakika|dk\b)/i);
  if (!saat && !dakika) return undefined;
  return (saat ? parseInt(saat[1], 10) * 60 : 0) + (dakika ? parseInt(dakika[1], 10) : 0);
}
