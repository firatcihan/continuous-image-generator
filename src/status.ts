import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Row } from './types.js';

export function outputPath(outputFolder: string, fileName: string): string {
  return join(outputFolder, `${fileName}.png`);
}

export function isCompleted(outputFolder: string, fileName: string): boolean {
  return existsSync(outputPath(outputFolder, fileName));
}

export function recordFailure(filePath: string, row: Row, reason: string): void {
  if (!existsSync(filePath)) {
    // Header stays Turkish: basarisizlar.csv is pasted back into the UI's CSV mode.
    appendFileSync(filePath, 'dosya_adi,metin,sebep\n', 'utf-8');
  }
  const escape = (field: string) => `"${field.replaceAll('"', '""')}"`;
  appendFileSync(filePath, `${escape(row.dosyaAdi)},${escape(row.metin)},${escape(reason)}\n`, 'utf-8');
}
