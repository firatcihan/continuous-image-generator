import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Logger } from '../src/logger.js';

describe('Logger', () => {
  it('mesajları zaman damgası ve seviyeyle dosyaya ekler', () => {
    const dosya = join(mkdtempSync(join(tmpdir(), 'log-')), 'calisma.log');
    const logger = new Logger(dosya);
    logger.bilgi('merhaba');
    logger.uyari('dikkat');
    logger.hata('patladı');

    const satirlar = readFileSync(dosya, 'utf-8').trim().split('\n');
    expect(satirlar).toHaveLength(3);
    expect(satirlar[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*\] BILGI merhaba$/);
    expect(satirlar[1]).toContain('UYARI dikkat');
    expect(satirlar[2]).toContain('HATA patladı');
  });
});
