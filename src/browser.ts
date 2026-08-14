import { writeFileSync } from 'node:fs';
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';
import { sleep } from './wait.js';
import { detectTransientError } from './transientError.js';
import { detectRateLimit } from './rateLimit.js';
import { CHATGPT_URL, SELECTORS } from './selectors.js';
import type { ImageResult, GenerationTab, GenerationBrowser } from './types.js';

/** The button dismissing the blocker modal — "Anladım" or "Got it" depending on UI language. */
const BLOCKER_BUTTON = /anladım|anladim|got it|tamam/i;

/**
 * ChatGPT's "new chat" keyboard shortcut.
 *
 * A shortcut instead of a selector: ChatGPT's sidebar layout and testids
 * change often, the shortcut does not. If it stops working we fall back to
 * full navigation anyway.
 */
const NEW_CHAT_SHORTCUT = process.platform === 'darwin' ? 'Meta+Shift+O' : 'Control+Shift+O';

/** Upper bound for verifying the in-app new chat actually opened. */
const NEW_CHAT_VERIFY_MS = 5_000;

const REFUSAL_PATTERNS = [
  /can('|’)?t (create|generate|help with) (that|this)/i,
  /unable to (create|generate)/i,
  /content polic(y|ies)/i,
  /violates? (our|the) polic/i,
  /bu görseli oluşturam/i,
  /içerik politika/i,
];

export class ChatgptBrowser implements GenerationBrowser {
  private context: BrowserContext | null = null;
  private pages: Page[] = [];
  /** Stored so relaunch() can rebuild the same number of tabs. */
  private tabCount = 1;

  constructor(
    private profilePath: string,
    /** Log hook used by the tabs; silent when omitted. */
    readonly logInfo: (message: string) => void = () => {},
  ) {}

  async launch(): Promise<void> {
    this.context = await chromium.launchPersistentContext(this.profilePath, {
      headless: false,
      viewport: null,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    const first = this.context.pages()[0] ?? (await this.context.newPage());
    await first.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded' });
    this.pages = [first];
    // Crash recovery rebuilds the previous tab count; on first launch
    // tabCount is 1 so this call is a no-op.
    await this.ensurePages(this.tabCount);
  }

  async relaunch(): Promise<void> {
    await this.close().catch(() => {});
    await this.launch();
  }

  async prepareTabs(n: number): Promise<GenerationTab[]> {
    this.tabCount = n;
    await this.ensurePages(n);
    return Array.from({ length: n }, (_, slot) => new ChatgptTab(this, slot));
  }

  async close(): Promise<void> {
    await this.context?.close();
    this.context = null;
    this.pages = [];
  }

  /**
   * For `ChatgptTab`: the slot's CURRENT page.
   * Relaunching refreshes the array, so tab handles stay valid.
   */
  pageAt(slot: number): Page {
    const page = this.pages[slot];
    if (!page) {
      throw new Error(`sekme ${slot} hazır değil; önce prepareTabs() çağrılmalı`);
    }
    return page;
  }

  private async ensurePages(n: number): Promise<void> {
    const context = this.context;
    if (!context) throw new Error('tarayıcı başlatılmadı; önce launch() çağrılmalı');

    while (this.pages.length < n) {
      const page = await context.newPage();
      await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded' });
      this.pages.push(page);
    }
  }
}

/**
 * A single tab handle. It does NOT hold a raw `Page`: `relaunch()` kills
 * every `Page` object; thanks to the slot indirection the handle a worker
 * holds stays valid across a crash.
 */
export class ChatgptTab implements GenerationTab {
  constructor(
    private parent: ChatgptBrowser,
    private slot: number,
  ) {}

  async openNewChat(): Promise<void> {
    // A FULL page navigation per row is precisely what triggers the
    // "Too many requests" modal: every load refetches the chat history and
    // 4 tabs × 30 rows do that dozens of times within minutes. The in-app
    // new chat gives the same result without refreshing the history.
    if (await this.inAppNewChat()) return;

    const page = this.page();
    await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded' });
    // The modal appears here most often. Clear it before waiting for the prompt box.
    await this.dismissBlocker();
    await page.waitForSelector(SELECTORS.promptBox, { timeout: 30_000 });
  }

  /**
   * Tries opening a new chat via the shortcut.
   *
   * The success criterion is BEHAVIOR, not a selector: did the chat really
   * empty and is the prompt box ready? If the shortcut stops working one day
   * this verification fails, `false` is returned and the caller falls back to
   * the old full navigation — no silent breakage.
   */
  private async inAppNewChat(): Promise<boolean> {
    const page = this.page();
    if (!page.url().startsWith(CHATGPT_URL)) return false; // not on the site yet

    await this.dismissBlocker();
    const box = page.locator(SELECTORS.promptBox).first();
    if (!(await box.isVisible().catch(() => false))) return false;

    await page.keyboard.press(NEW_CHAT_SHORTCUT).catch(() => {});

    const deadline = Date.now() + NEW_CHAT_VERIFY_MS;
    for (;;) {
      const emptied = (await page.locator(SELECTORS.conversationTurn).count().catch(() => 1)) === 0;
      const ready = await box.isVisible().catch(() => false);
      if (emptied && ready) return true;
      if (Date.now() >= deadline) break;
      await sleep(250);
    }

    this.parent.logInfo('uygulama içi yeni sohbet tutmadı; tam sayfa gezinmeye düşülüyor');
    return false;
  }

  /**
   * If the "Too many requests" modal is open, clicks "Anladım" to dismiss it.
   * Does nothing when it is not open. Returns: was the modal really dismissed?
   *
   * No step here throws — this is a recovery path, it must not become a new
   * source of failure itself.
   */
  async dismissBlocker(): Promise<boolean> {
    const modal = this.page().locator(SELECTORS.blockerModal).first();
    if (!(await modal.isVisible().catch(() => false))) return false;

    const button = modal.getByRole('button', { name: BLOCKER_BUTTON }).first();
    await button.click({ timeout: 5_000 }).catch(() => {});
    const dismissed = await modal
      .waitFor({ state: 'hidden', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);

    this.parent.logInfo(
      dismissed
        ? '"Çok fazla istek" kutusu kapatıldı; üretime devam ediliyor'
        : '"Çok fazla istek" kutusu kapatılamadı; tıklama engelli kalabilir',
    );
    return dismissed;
  }

  /**
   * Clicks even if the blocker modal gets in the way.
   *
   * There is always a race window between dismissing and clicking: the modal
   * can open at exactly that moment. So when the click is intercepted, the
   * modal is dismissed once more and the click retried. If no modal was there,
   * the original error propagates — a real failure must not be swallowed.
   */
  private async clickPastBlocker(target: Locator): Promise<void> {
    await this.dismissBlocker();
    try {
      await target.click({ timeout: 15_000 });
    } catch (error) {
      if (!(await this.dismissBlocker())) throw error;
      await target.click({ timeout: 15_000 });
    }
  }

  async isLoggedIn(): Promise<boolean> {
    const loginButton = this.page().getByRole('button', { name: /log ?in|giriş yap/i });
    const loginVisible = await loginButton
      .first()
      .isVisible()
      .catch(() => false);
    return !loginVisible;
  }

  async activeModelName(): Promise<string> {
    const switcher = this.page().locator(SELECTORS.modelSwitcher).first();
    const visible = await switcher.isVisible().catch(() => false);
    if (!visible) return '';
    return ((await switcher.textContent()) ?? '').trim();
  }

  async generateImage(prompt: string, timeoutSec: number): Promise<ImageResult> {
    const page = this.page();
    const previousImageCount = await page.locator(SELECTORS.conversationImage).count();

    const box = page.locator(SELECTORS.promptBox);
    await this.clickPastBlocker(box);
    await box.fill(prompt);
    await page.keyboard.press('Enter');

    const deadline = Date.now() + timeoutSec * 1000;
    while (Date.now() < deadline) {
      await sleep(2000);

      // The modal can open while generation runs, too. Dismiss it here rather
      // than waiting for the next row's click: the 2-second loop is the
      // practical equivalent of "continuously".
      await this.dismissBlocker();

      const alerts = await page
        .locator(SELECTORS.alertBox)
        .allInnerTexts()
        .catch(() => [] as string[]);
      const checkText = (await this.lastTurnText()) + '\n' + alerts.join('\n');

      if (detectRateLimit(checkText).limited) {
        return { type: 'rateLimit', message: checkText };
      }
      if (REFUSAL_PATTERNS.some((pattern) => pattern.test(checkText))) {
        return { type: 'refusal', message: checkText };
      }
      // Checked AFTER rate limit and refusal: those two have their own
      // handling paths. Left uncaught here, generation would idle until the
      // timeout (default 180 s) for nothing.
      if (detectTransientError(checkText)) {
        return { type: 'transientError', message: checkText.slice(0, 300) };
      }

      const generating = await page
        .locator(SELECTORS.stopButton)
        .isVisible()
        .catch(() => false);
      const imageCount = await page.locator(SELECTORS.conversationImage).count();
      if (!generating && imageCount > previousImageCount) {
        await sleep(2000); // short margin for the image to load at full resolution
        return { type: 'image' };
      }
    }
    return { type: 'timeout' };
  }

  async saveLastImage(targetPath: string): Promise<void> {
    const page = this.page();
    const image = page.locator(SELECTORS.conversationImage).last();
    const src = await image.getAttribute('src');
    if (!src) throw new Error('görsel src özniteliği bulunamadı');

    let data: Buffer;
    if (src.startsWith('blob:') || src.startsWith('data:')) {
      const base64 = await page.evaluate(async (url) => {
        const response = await fetch(url);
        const blob = await response.blob();
        return await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(blob);
        });
      }, src);
      data = Buffer.from(base64, 'base64');
    } else {
      const response = await page.request.get(src);
      if (!response.ok()) throw new Error(`görsel indirilemedi: HTTP ${response.status()}`);
      data = Buffer.from(await response.body());
    }
    writeFileSync(targetPath, data);
  }

  private page(): Page {
    return this.parent.pageAt(this.slot);
  }

  private async lastTurnText(): Promise<string> {
    const turns = this.page().locator(SELECTORS.conversationTurn);
    const count = await turns.count();
    if (count === 0) return '';
    return (await turns.last().innerText().catch(() => '')) ?? '';
  }
}
