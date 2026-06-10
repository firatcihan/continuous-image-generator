export function promptOlustur(basePrompt: string, metin: string): string {
  if (!basePrompt.includes('{VARYASYON}')) {
    throw new Error('basePrompt içinde {VARYASYON} yer tutucusu bulunamadı');
  }
  return basePrompt.replaceAll('{VARYASYON}', metin);
}
