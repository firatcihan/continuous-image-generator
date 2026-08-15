import { describe, expect, it } from 'vitest';
import type { BrowserContext } from 'playwright';
import { ChatgptBrowser } from '../src/browser.js';

/** The slice of Playwright's `BrowserContext` that `launch()` actually touches. */
function fakeContext() {
  const closeListeners: Array<() => void> = [];
  const pages: unknown[] = [];
  const context = {
    pages: () => pages,
    newPage: async () => {
      const page = { goto: async () => {} };
      pages.push(page);
      return page;
    },
    // Playwright emits 'close' for a context closed on purpose too — which is
    // exactly why the suppression tests below are worth anything.
    close: async () => { for (const listener of [...closeListeners]) listener(); },
    on: (event: string, listener: () => void) => {
      if (event === 'close') closeListeners.push(listener);
    },
    killWindow: () => { for (const listener of [...closeListeners]) listener(); },
  };
  return context;
}

type FakeContext = ReturnType<typeof fakeContext>;

/** Hands out a fresh fake context per launch and records them in order. */
function launcher() {
  const created: FakeContext[] = [];
  const launch = async () => {
    const context = fakeContext();
    created.push(context);
    return context as unknown as BrowserContext;
  };
  return { created, launch };
}

describe('ChatgptBrowser.onClosed', () => {
  // The user closing the Chromium window is invisible to the process: the
  // ChatgptBrowser handle stays alive, so start.ts kept reporting "browser
  // open", the UI kept Başlat enabled, and pressing it threw deep inside a
  // detached async job. The context's own 'close' event is the only signal.
  it('fires when the window is closed from outside', async () => {
    const { created, launch } = launcher();
    const browser = new ChatgptBrowser('/tmp/profil', () => {}, launch);
    let closedReports = 0;
    browser.onClosed(() => { closedReports++; });

    await browser.launch();
    expect(closedReports).toBe(0);

    created[0].killWindow();

    expect(closedReports).toBe(1);
  });

  // We asked for this one. Reporting it would make the session drop a browser
  // it is in the middle of shutting down on purpose.
  it('stays quiet when we close the browser ourselves', async () => {
    const { launch } = launcher();
    const browser = new ChatgptBrowser('/tmp/profil', () => {}, launch);
    let closedReports = 0;
    browser.onClosed(() => { closedReports++; });

    await browser.launch();
    await browser.close();

    expect(closedReports).toBe(0);
  });

  // relaunch() is the crash-recovery path a running job depends on. If the
  // close half of it reported as "the user closed the browser", the session
  // would null out the handle mid-job and the job would die on the restart
  // that was meant to save it.
  it('stays quiet through a relaunch but still reports the new window closing', async () => {
    const { created, launch } = launcher();
    const browser = new ChatgptBrowser('/tmp/profil', () => {}, launch);
    let closedReports = 0;
    browser.onClosed(() => { closedReports++; });

    await browser.launch();
    await browser.relaunch();

    expect(closedReports).toBe(0);
    expect(created).toHaveLength(2);

    created[1].killWindow();

    expect(closedReports).toBe(1);
  });
});
