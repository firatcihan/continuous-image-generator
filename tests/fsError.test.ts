import { describe, expect, it } from 'vitest';
import { isFileSystemError } from '../src/fsError.js';

/** Builds the shape Node gives an fs failure: an Error carrying a `code`. */
function fsError(code: string): Error {
  return Object.assign(new Error(`fs failed: ${code}`), { code });
}

describe('isFileSystemError', () => {
  it('recognises the codes a failing image write produces', () => {
    for (const code of ['ENOSPC', 'EACCES', 'EPERM', 'EROFS', 'ENOTDIR', 'EISDIR', 'ENOENT', 'EDQUOT']) {
      expect(isFileSystemError(fsError(code))).toBe(true);
    }
  });

  // Playwright errors are plain Errors with no `code`. Misreading one as a
  // disk problem would SKIP the browser restart that actually fixes it.
  it('does not claim a plain browser error', () => {
    expect(isFileSystemError(new Error('Target page, context or browser has been closed'))).toBe(false);
    expect(isFileSystemError(new Error('Timeout 30000ms exceeded'))).toBe(false);
  });

  it('does not claim an unrelated code', () => {
    expect(isFileSystemError(fsError('ECONNRESET'))).toBe(false);
    expect(isFileSystemError(fsError('ETIMEDOUT'))).toBe(false);
  });

  it('survives values that are not errors at all', () => {
    expect(isFileSystemError(null)).toBe(false);
    expect(isFileSystemError(undefined)).toBe(false);
    expect(isFileSystemError('ENOSPC')).toBe(false);
    expect(isFileSystemError({ code: 42 })).toBe(false);
  });
});
