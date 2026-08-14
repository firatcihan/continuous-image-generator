export interface RateLimitInfo {
  limited: boolean;
  waitMinutes?: number;
}

const LIMIT_PATTERNS = [
  /you('|’)ve reached (your|our|the)?\s*.*limit/i,
  /you('|’)ve hit (your|the)?\s*.*limit/i,
  /image generation limit/i,
  /too many requests/i,
  /try again (in|after|later)/i,
  /limit(in)? (doldu|aşıldı)/i,
  /sonra tekrar dene/i,
];

export function detectRateLimit(text: string): RateLimitInfo {
  if (!LIMIT_PATTERNS.some((pattern) => pattern.test(text))) {
    return { limited: false };
  }
  return { limited: true, waitMinutes: extractWaitMinutes(text) };
}

export function extractWaitMinutes(text: string): number | undefined {
  const hours = text.match(/(\d+)\s*(hours?|saat)/i);
  const minutes = text.match(/(\d+)\s*(minutes?|mins?\b|dakika|dk\b)/i);
  if (!hours && !minutes) return undefined;
  return (hours ? parseInt(hours[1], 10) * 60 : 0) + (minutes ? parseInt(minutes[1], 10) : 0);
}
