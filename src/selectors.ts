/**
 * DOM selectors for the ChatGPT web UI.
 * When the UI changes, only this file needs updating.
 */
export const SELECTORS = {
  promptBox: '#prompt-textarea',
  sendButton: '[data-testid="send-button"]',
  stopButton: '[data-testid="stop-button"]',
  modelSwitcher: '[data-testid="model-switcher-dropdown-button"]',
  conversationTurn: '[data-testid^="conversation-turn"]',
  conversationImage:
    '[data-testid^="conversation-turn"] img[src^="http"], [data-testid^="conversation-turn"] img[src^="blob:"]',
  alertBox: '[role="alert"]',
  /**
   * The "Too many requests" modal. NOT the image generation limit: it is the
   * chat-history restriction that appears after opening new chats in rapid
   * succession. Generation can continue once it is dismissed.
   * The modal is an `inset-0` layer, so if left open it swallows every click
   * underneath and Playwright times out with "subtree intercepts pointer
   * events".
   */
  blockerModal: '#modal-conversation-history-rate-limit',
};

export const CHATGPT_URL = 'https://chatgpt.com/';
