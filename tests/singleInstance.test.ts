import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claimSingleInstance, releaseSingleInstance } from '../src/singleInstance.js';

const lockPath = (): string => join(mkdtempSync(join(tmpdir(), 'kilit-')), 'calisiyor.json');

const alive = () => true;
const dead = () => false;

describe('claimSingleInstance', () => {
  it('claims a free lock and records pid and url', () => {
    const path = lockPath();

    const result = claimSingleInstance(path, { pid: 4242, url: 'http://127.0.0.1:5173/?t=abc' }, dead);

    expect(result.claimed).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({
      pid: 4242,
      url: 'http://127.0.0.1:5173/?t=abc',
    });
  });

  it('refuses when a live process holds the lock and reports its url', () => {
    const path = lockPath();
    writeFileSync(path, JSON.stringify({ pid: 111, url: 'http://127.0.0.1:1/?t=eski' }), 'utf-8');

    const result = claimSingleInstance(path, { pid: 222, url: 'http://127.0.0.1:2/?t=yeni' }, alive);

    expect(result).toEqual({
      claimed: false,
      running: { pid: 111, url: 'http://127.0.0.1:1/?t=eski' },
    });
    // the running instance's lock must survive untouched
    expect(JSON.parse(readFileSync(path, 'utf-8')).pid).toBe(111);
  });

  it('takes over a lock left behind by a dead process', () => {
    const path = lockPath();
    writeFileSync(path, JSON.stringify({ pid: 111, url: 'http://127.0.0.1:1/?t=eski' }), 'utf-8');

    const result = claimSingleInstance(path, { pid: 222, url: 'http://127.0.0.1:2/?t=yeni' }, dead);

    expect(result.claimed).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf-8')).pid).toBe(222);
  });

  // A half-written or hand-edited file must not lock the user out for good.
  it('takes over an unreadable lock', () => {
    const path = lockPath();
    writeFileSync(path, '{ yarim', 'utf-8');

    const result = claimSingleInstance(path, { pid: 222, url: 'http://127.0.0.1:2/?t=yeni' }, alive);

    expect(result.claimed).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf-8')).pid).toBe(222);
  });
});

describe('releaseSingleInstance', () => {
  it('removes our own lock', () => {
    const path = lockPath();
    claimSingleInstance(path, { pid: 4242, url: 'http://127.0.0.1:5173/' }, dead);

    releaseSingleInstance(path, 4242);

    expect(existsSync(path)).toBe(false);
  });

  // Our stale lock may already have been taken over by a newer instance; on
  // shutdown we must not delete the lock that now belongs to it.
  it('leaves a lock owned by another pid alone', () => {
    const path = lockPath();
    claimSingleInstance(path, { pid: 999, url: 'http://127.0.0.1:5173/' }, dead);

    releaseSingleInstance(path, 4242);

    expect(existsSync(path)).toBe(true);
  });

  it('stays quiet when there is no lock file', () => {
    expect(() => releaseSingleInstance(lockPath(), 4242)).not.toThrow();
  });
});
