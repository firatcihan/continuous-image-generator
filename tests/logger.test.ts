import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Logger } from '../src/logger.js';

describe('Logger', () => {
  it('appends messages to the file with timestamp and level', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'log-')), 'calisma.log');
    const logger = new Logger(file);
    logger.info('merhaba');
    logger.warn('dikkat');
    logger.error('patladı');

    const lines = readFileSync(file, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(3);
    // Level tags are Turkish on purpose — part of the calisma.log format.
    expect(lines[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*\] BILGI merhaba$/);
    expect(lines[1]).toContain('UYARI dikkat');
    expect(lines[2]).toContain('HATA patladı');
  });
});
