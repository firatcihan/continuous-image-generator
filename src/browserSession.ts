/**
 * What the session needs from a browser. `ChatgptBrowser` satisfies it; tests
 * substitute a fake so no Chromium has to start.
 */
export interface SessionBrowser {
  launch(): Promise<void>;
  close(): Promise<void>;
  /** Is a live browser attached right now? */
  isAlive(): boolean;
}

/**
 * Holds the one browser the app opens, and answers "is it open?" honestly.
 *
 * This used to be a bare `let browser` in start.ts, set on open and cleared on
 * close — which meant it only ever tracked the closes WE performed. A user
 * closing the Chromium window by hand changed nothing: `isBrowserOpen()` kept
 * answering true, the UI kept saying "✓ Tarayıcı açık" with Başlat enabled,
 * and the job then threw inside a detached async function where the failure
 * reached nothing but calisma.log.
 *
 * So openness is never cached here. Every answer is read from the handle
 * itself, which is also what keeps `relaunch()` honest: crash recovery revives
 * the SAME handle from inside a running job, and a latched flag would report
 * "closed" while a browser is genuinely running — letting the user open a
 * second Chromium on top of a live job.
 */
export class BrowserSession<T extends SessionBrowser> {
  private browser: T | null = null;

  constructor(private create: () => T) {}

  isOpen(): boolean {
    return this.browser !== null && this.browser.isAlive();
  }

  /** The live browser, or null when there is none. */
  get(): T | null {
    return this.isOpen() ? this.browser : null;
  }

  /** Opens a browser if none is live; returns the live one either way. */
  async open(): Promise<T> {
    const existing = this.browser;
    if (existing !== null && existing.isAlive()) return existing;

    // Assigned only after a successful launch: on failure the session stays
    // closed and the user can simply press the button again.
    const fresh = this.create();
    await fresh.launch();
    this.browser = fresh;
    return fresh;
  }

  /** Closes the browser. A close that throws still leaves the session closed. */
  async close(): Promise<void> {
    const open = this.browser;
    this.browser = null;
    await open?.close().catch(() => {});
  }
}
