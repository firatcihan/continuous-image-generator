import type { Row } from './types.js';

/** User-facing placeholder — kept Turkish, it lives inside users' saved prompts. */
export const PLACEHOLDER = '{VARYASYON}';

export function buildPrompt(basePrompt: string, text: string): string {
  if (!basePrompt.includes(PLACEHOLDER)) {
    throw new Error(`basePrompt içinde ${PLACEHOLDER} yer tutucusu bulunamadı`);
  }
  return basePrompt.replaceAll(PLACEHOLDER, text);
}

export function hasPlaceholder(basePrompt: string): boolean {
  return basePrompt.includes(PLACEHOLDER);
}

/** Renders the first `count` rows as they would actually be sent. Empty when there is no placeholder. */
export function buildPreviews(basePrompt: string, rows: Row[], count = 3): string[] {
  if (!hasPlaceholder(basePrompt)) return [];
  return rows.slice(0, count).map((row) => buildPrompt(basePrompt, row.metin));
}
