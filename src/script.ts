import { sanitizeFileName } from './list.js';
import type { Row } from './types.js';

/**
 * Only stamps inside parentheses or square brackets. A bare `9:30` is
 * DELIBERATELY excluded: "saat 9:30'da" inside spoken text would split the
 * script at the wrong place.
 */
const STAMP = /[(\[]\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[)\]]/g;

/**
 * Converts a time-stamped script into rows. The piece BEFORE stamp **i** is
 * named after stamp **i** — the user reads from the file name up to which
 * moment of the video the image lasts. No stamp terminates the piece after
 * the last stamp; the `_son` suffix both names it and avoids clashing with
 * that same stamp.
 */
export function scriptToRows(content: string): Row[] {
  const stamps = [...content.matchAll(STAMP)].map((match) => ({
    value: match[1],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
  if (stamps.length === 0) {
    throw new Error('Script içinde (0:00) biçiminde zaman damgası bulunamadı');
  }

  const pieces: { text: string; name: string }[] = [];
  let cursor = 0;
  for (const stamp of stamps) {
    pieces.push({ text: content.slice(cursor, stamp.start), name: stamp.value });
    cursor = stamp.end;
  }
  const lastStamp = stamps[stamps.length - 1].value;
  pieces.push({ text: content.slice(cursor), name: `${lastStamp}_son` });

  const rows: Row[] = [];
  const seen = new Map<string, number>();
  for (const piece of pieces) {
    const metin = collapseWhitespace(piece.text);
    if (metin === '') continue; // empty gap between two consecutive stamps — no row
    rows.push({ metin, dosyaAdi: uniqueName(sanitizeFileName(piece.name), seen) });
  }
  if (rows.length === 0) throw new Error('Script içinde çevrilecek metin yok');
  return rows;
}

/** The text replaces `{VARYASYON}` inside the prompt box; line breaks carry no meaning there. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * When the same stamp appears twice the second name becomes `_2`. A duplicate
 * file name would turn the save into a 400, and the user could not tell which
 * row to fix by hand.
 */
function uniqueName(name: string, seen: Map<string, number>): string {
  const count = (seen.get(name) ?? 0) + 1;
  seen.set(name, count);
  return count === 1 ? name : `${name}_${count}`;
}
