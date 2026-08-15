import { describe, expect, it } from 'vitest';
import { BrowserSession, type SessionBrowser } from '../src/browserSession.js';

class FakeBrowser implements SessionBrowser {
  launches = 0;
  closes = 0;
  launchError: Error | null = null;
  private alive = false;

  async launch(): Promise<void> {
    if (this.launchError !== null) throw this.launchError;
    this.launches++;
    this.alive = true;
  }

  async close(): Promise<void> {
    this.closes++;
    this.alive = false;
  }

  isAlive(): boolean {
    return this.alive;
  }

  /** The window going away without us asking. */
  killWindow(): void {
    this.alive = false;
  }
}

/** A session over a queue of browsers, so each launch gets a distinct handle. */
function sessionOver(...browsers: FakeBrowser[]) {
  const queue = [...browsers];
  const made: FakeBrowser[] = [];
  const session = new BrowserSession<FakeBrowser>(() => {
    const browser = queue.shift() ?? new FakeBrowser();
    made.push(browser);
    return browser;
  });
  return { session, made };
}

describe('BrowserSession', () => {
  it('reports closed before anything is opened', () => {
    const { session } = sessionOver();
    expect(session.isOpen()).toBe(false);
    expect(session.get()).toBeNull();
  });

  it('opens the browser and reports it open', async () => {
    const { session, made } = sessionOver();
    const browser = await session.open();

    expect(session.isOpen()).toBe(true);
    expect(session.get()).toBe(browser);
    expect(made[0].launches).toBe(1);
  });

  it('reuses the open browser instead of launching a second one', async () => {
    const { session, made } = sessionOver();
    const first = await session.open();
    const second = await session.open();

    expect(second).toBe(first);
    expect(made).toHaveLength(1);
  });

  // The bug this class exists for: the user closes the Chromium window by
  // hand. Nothing in the process noticed, so `isBrowserOpen()` kept answering
  // true — the UI said "✓ Tarayıcı açık", Başlat stayed enabled, and the job
  // blew up inside a detached async function where nobody could see it.
  it('reports closed once the window has gone away', async () => {
    const { session, made } = sessionOver();
    await session.open();

    made[0].killWindow();

    expect(session.isOpen()).toBe(false);
    expect(session.get()).toBeNull();
  });

  it('opens a fresh browser after the previous window went away', async () => {
    const { session, made } = sessionOver();
    await session.open();
    made[0].killWindow();

    await session.open();

    expect(made).toHaveLength(2);
    expect(session.isOpen()).toBe(true);
  });

  // Crash recovery (`relaunch()`) revives the handle the session is already
  // holding. Were "open" a flag latched on the session's own close event, it
  // would still read closed while a browser is genuinely running — and the
  // user could open a SECOND Chromium on top of a live job.
  it('reports open again when the same handle revives itself', async () => {
    const { session, made } = sessionOver();
    await session.open();
    made[0].killWindow();
    expect(session.isOpen()).toBe(false);

    await made[0].launch(); // what relaunch() does from inside a running job

    expect(session.isOpen()).toBe(true);
    expect(session.get()).toBe(made[0]);
  });

  it('stays closed and retryable when the launch fails', async () => {
    const failing = new FakeBrowser();
    failing.launchError = new Error('chromium başlatılamadı');
    const { session, made } = sessionOver(failing, new FakeBrowser());

    await expect(session.open()).rejects.toThrow('chromium başlatılamadı');
    expect(session.isOpen()).toBe(false);

    await session.open();
    expect(session.isOpen()).toBe(true);
    expect(made).toHaveLength(2);
  });

  it('close() shuts the browser down and reports closed', async () => {
    const { session, made } = sessionOver();
    await session.open();

    await session.close();

    expect(made[0].closes).toBe(1);
    expect(session.isOpen()).toBe(false);
  });

  it('close() on a session that was never opened does nothing', async () => {
    const { session, made } = sessionOver();
    await session.close();
    expect(made).toHaveLength(0);
  });

  // A close that fails must not leave the session believing it still has a
  // usable browser — there would be no way back except restarting the process.
  it('reports closed even when shutting down throws', async () => {
    const stubborn = new FakeBrowser();
    stubborn.close = async () => { throw new Error('kapanmadı'); };
    const { session } = sessionOver(stubborn);
    await session.open();

    await session.close();

    expect(session.isOpen()).toBe(false);
  });
});
