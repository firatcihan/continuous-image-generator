import { describe, expect, it } from 'vitest';
import { buildPrompt, PLACEHOLDER, buildPreviews, hasPlaceholder } from '../src/prompt.js';
import type { Row } from '../src/types.js';

describe('buildPrompt', () => {
  it('replaces the {VARYASYON} placeholder with the text', () => {
    expect(buildPrompt('Bir kedi, {VARYASYON}, detaylı', 'karda')).toBe('Bir kedi, karda, detaylı');
  });

  it('replaces every occurrence when {VARYASYON} appears multiple times', () => {
    expect(buildPrompt('{VARYASYON} ve {VARYASYON}', 'x')).toBe('x ve x');
  });

  it('throws when the placeholder is missing', () => {
    expect(() => buildPrompt('yer tutucu yok', 'x')).toThrow('{VARYASYON}');
  });
});

const ROWS: Row[] = [
  { metin: 'karda', dosyaAdi: 'a' },
  { metin: 'plajda', dosyaAdi: 'b' },
  { metin: 'ormanda', dosyaAdi: 'c' },
  { metin: 'çölde', dosyaAdi: 'd' },
];

describe('hasPlaceholder', () => {
  it('true when the placeholder is present', () => {
    expect(hasPlaceholder(`Bir kedi, ${PLACEHOLDER}`)).toBe(true);
  });
  it('false when the placeholder is missing', () => {
    expect(hasPlaceholder('Bir kedi')).toBe(false);
  });
});

describe('buildPreviews', () => {
  it('renders the first 3 rows by default', () => {
    const previews = buildPreviews(`Bir kedi, ${PLACEHOLDER}, detaylı`, ROWS);
    expect(previews).toEqual([
      'Bir kedi, karda, detaylı',
      'Bir kedi, plajda, detaylı',
      'Bir kedi, ormanda, detaylı',
    ]);
  });

  it('honors the count parameter', () => {
    expect(buildPreviews(`X ${PLACEHOLDER}`, ROWS, 1)).toEqual(['X karda']);
  });

  it('returns them all when there are fewer rows than count', () => {
    expect(buildPreviews(`X ${PLACEHOLDER}`, [ROWS[0]])).toEqual(['X karda']);
  });

  it('replaces every one of multiple placeholders', () => {
    expect(buildPreviews(`${PLACEHOLDER} ve ${PLACEHOLDER}`, [ROWS[0]], 1)).toEqual([
      'karda ve karda',
    ]);
  });

  it('returns an empty array instead of throwing when the placeholder is missing', () => {
    expect(buildPreviews('Bir kedi', ROWS)).toEqual([]);
  });

  it('returns an empty array when there are no rows', () => {
    expect(buildPreviews(`X ${PLACEHOLDER}`, [])).toEqual([]);
  });
});
