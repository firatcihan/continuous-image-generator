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
  /**
   * "Çok fazla istek" kutusu. Görsel üretme limiti DEĞİL: art arda yeni sohbet
   * açınca gelen sohbet-geçmişi kısıtı. Kapatınca üretime devam edilebiliyor.
   * Kutu `inset-0` bir katman olduğu için kapatılmazsa altındaki her tıklamayı
   * yutar ve Playwright "subtree intercepts pointer events" ile zaman aşımına
   * uğrar.
   */
  engelKutusu: '#modal-conversation-history-rate-limit',
};

export const CHATGPT_URL = 'https://chatgpt.com/';
