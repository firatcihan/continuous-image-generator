import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Only ONE server may run per data folder. Not a nicety: every instance drives
 * Chromium through the SAME `chrome_profil` folder, and the second launch does
 * not get a window — Chrome sees the profile's singleton lock, hands the
 * command line to the instance that owns it and exits, which reaches the user
 * as "Target page, context or browser has been closed".
 */
export interface RunningInstance {
  pid: number;
  /** With the token in it, so the message can be opened as-is. */
  url: string;
}

export type ClaimResult = { claimed: true } | { claimed: false; running: RunningInstance };

export function lockFilePath(dataRoot: string): string {
  return join(dataRoot, 'calisiyor.json');
}

/**
 * Signal 0 asks the kernel about a pid without sending anything. EPERM means
 * the process exists but belongs to someone else — still alive, so still a
 * holder. Only ESRCH (and a nonsense pid) counts as gone.
 *
 * Pid reuse is the known hole: a recycled pid now owned by an unrelated
 * program reads as "still running". The cost is a refused start with a URL
 * that answers nothing, which the user can clear by deleting the lock file —
 * far cheaper than the silent browser failure two live instances cause.
 */
function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === 'EPERM';
  }
}

function readLock(lockPath: string): RunningInstance | null {
  try {
    const data: unknown = JSON.parse(readFileSync(lockPath, 'utf-8'));
    if (typeof data !== 'object' || data === null) return null;
    const { pid, url } = data as { pid?: unknown; url?: unknown };
    if (typeof pid !== 'number' || typeof url !== 'string') return null;
    return { pid, url };
  } catch {
    // missing, half-written or hand-edited: treat as no lock at all
    return null;
  }
}

/**
 * Claims the lock for this process. A lock whose owner is gone (or whose
 * contents make no sense) is taken over; a live owner is reported back so the
 * caller can point the user at the instance already running.
 *
 * `isAlive` is injected for the tests; production passes nothing.
 */
export function claimSingleInstance(
  lockPath: string,
  instance: RunningInstance,
  isAlive: (pid: number) => boolean = processAlive,
): ClaimResult {
  const existing = readLock(lockPath);
  if (existing !== null && isAlive(existing.pid)) {
    return { claimed: false, running: existing };
  }

  // Mode 0600: the url carries the session token.
  writeFileSync(lockPath, JSON.stringify(instance), { encoding: 'utf-8', mode: 0o600 });
  return { claimed: true };
}

/**
 * Releases the lock on shutdown. The pid check matters for the stale case: if
 * this process's lock was already taken over by a newer instance, deleting the
 * file would leave that instance unprotected.
 */
export function releaseSingleInstance(lockPath: string, pid: number): void {
  const existing = readLock(lockPath);
  if (existing === null || existing.pid !== pid) return;
  try {
    unlinkSync(lockPath);
  } catch {
    // already gone, or a read-only data folder: nothing left to do
  }
}
