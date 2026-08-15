import { appendFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Row } from './types.js';

export function outputPath(outputFolder: string, fileName: string): string {
  return join(outputFolder, `${fileName}.png`);
}

/**
 * The resume rule: a row is done when its PNG sits on disk.
 *
 * The size check is not decoration. A 0-byte file is not a produced image, it
 * is the residue of a write cut short — a crash or a full disk. Counted as
 * done, that row would be skipped on every later run and the user would keep a
 * broken file with no retry ever. `saveLastImage` writes atomically so such a
 * file should not appear in the first place; this is the second lock, covering
 * files that arrived some other way.
 */
export function isCompleted(outputFolder: string, fileName: string): boolean {
  try {
    return statSync(outputPath(outputFolder, fileName)).size > 0;
  } catch {
    return false; // missing, or unreadable — either way not a finished row
  }
}

export function recordFailure(filePath: string, row: Row, reason: string): void {
  if (!existsSync(filePath)) {
    // Header stays Turkish: basarisizlar.csv is pasted back into the UI's CSV mode.
    appendFileSync(filePath, 'dosya_adi,metin,sebep\n', 'utf-8');
  }
  const escape = (field: string) => `"${field.replaceAll('"', '""')}"`;
  appendFileSync(filePath, `${escape(row.dosyaAdi)},${escape(row.metin)},${escape(reason)}\n`, 'utf-8');
}
