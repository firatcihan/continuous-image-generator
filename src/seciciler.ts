/**
 * ChatGPT web arayüzü DOM seçicileri.
 * Arayüz değiştiğinde yalnızca bu dosya güncellenir.
 */
export const SECICILER = {
  promptKutusu: '#prompt-textarea',
  gonderButonu: '[data-testid="send-button"]',
  durdurButonu: '[data-testid="stop-button"]',
  modelSecici: '[data-testid="model-switcher-dropdown-button"]',
  sohbetTuru: '[data-testid^="conversation-turn"]',
  sohbetGorseli:
    '[data-testid^="conversation-turn"] img[src^="http"], [data-testid^="conversation-turn"] img[src^="blob:"]',
  uyariKutusu: '[role="alert"]',
};

export const CHATGPT_URL = 'https://chatgpt.com/';
