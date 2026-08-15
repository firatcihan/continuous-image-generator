import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatgptBrowser, ChatgptTab } from '../src/browser.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gorsel-kaydet-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The slice of Playwright's `Page` that `saveLastImage` actually touches. */
function fakePage(source: string, body: () => Promise<Buffer>, ok = true) {
  return {
    locator: () => ({ last: () => ({ getAttribute: async () => source }) }),
    request: {
      get: async () => ({ ok: () => ok, status: () => (ok ? 200 : 500), body }),
    },
  };
}

function tabFor(page: unknown): ChatgptTab {
  const parent = { pageAt: () => page, logInfo: () => {} } as unknown as ChatgptBrowser;
  return new ChatgptTab(parent, 0);
}

describe('saveLastImage', () => {
  it('writes the downloaded bytes verbatim', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
    const target = join(root, 'a.png');

    await tabFor(fakePage('http://x/a.png', async () => png)).saveLastImage(target);

    expect(readFileSync(target).equals(png)).toBe(true);
  });

  it('leaves no temp file behind', async () => {
    const target = join(root, 'a.png');
    await tabFor(fakePage('http://x/a.png', async () => Buffer.from([1, 2, 3])))
      .saveLastImage(target);

    expect(readdirSync(root)).toEqual(['a.png']);
  });

  // The whole point of the atomic write: a failure partway through must not
  // leave a truncated PNG at the target path. `isCompleted` is a plain
  // `existsSync`, so a half-written file would be counted as done and that row
  // would be skipped forever on the next run — the user keeps a corrupt image
  // and never gets a retry.
  it('leaves nothing at the target path when the download fails mid-way', async () => {
    const target = join(root, 'a.png');
    const tab = tabFor(fakePage('http://x/a.png', async () => {
      throw new Error('bağlantı koptu');
    }));

    await expect(tab.saveLastImage(target)).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });

  // An empty body still passes `response.ok()`. Written out, it becomes a
  // 0-byte .png that `isCompleted` counts as a finished row.
  it('rejects an empty body instead of writing a 0-byte png', async () => {
    const target = join(root, 'a.png');
    const tab = tabFor(fakePage('http://x/a.png', async () => Buffer.alloc(0)));

    await expect(tab.saveLastImage(target)).rejects.toThrow(/boş/);
    expect(existsSync(target)).toBe(false);
  });

  it('throws when the image request is not ok', async () => {
    const tab = tabFor(fakePage('http://x/a.png', async () => Buffer.from([1]), false));
    await expect(tab.saveLastImage(join(root, 'a.png'))).rejects.toThrow(/HTTP 500/);
  });
});
