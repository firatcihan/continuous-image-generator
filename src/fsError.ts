/**
 * File system failures a row can hit while its PNG is written.
 *
 * Kept narrow on purpose. The point of the check is deciding whether to
 * RESTART THE BROWSER, and the two mistakes are not equally cheap: calling a
 * browser error a disk error skips the restart that would have fixed it, so
 * anything ambiguous is deliberately left out (network-flavoured codes like
 * ECONNRESET belong to the browser side).
 */
const FS_ERROR_CODES = new Set([
  'ENOSPC', // disk full
  'EDQUOT', // quota exhausted
  'EACCES', // no permission
  'EPERM',
  'EROFS', // read-only file system
  'ENOTDIR', // a path component is a file, not a folder
  'EISDIR', // the target itself is a folder
  'ENOENT', // the output folder went away mid-run
  'EMFILE', // too many open files
  'ENFILE',
]);

/**
 * Did this failure come from the disk rather than the browser?
 *
 * Node stamps fs errors with a string `code`; Playwright's errors are plain
 * Errors without one, which is what separates the two.
 */
export function isFileSystemError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && FS_ERROR_CODES.has(code);
}
