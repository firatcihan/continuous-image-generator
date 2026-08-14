import type { Row } from './types.js';

/** Mini CSV parser with quoted-field and CRLF support. */
export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;

  const endRow = () => {
    fields.push(field);
    field = '';
    if (fields.some((f) => f.trim() !== '')) rows.push(fields);
    fields = [];
  };

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (inQuotes) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && content[i + 1] === '\n') i++;
      endRow();
    } else {
      field += char;
    }
  }
  endRow();
  return rows;
}

export function sanitizeFileName(name: string): string {
  return name
    .trim()
    .replace(/\.png$/i, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();
}

/**
 * Turns `metin,dosya_adi` CSV text into rows. The header row is optional:
 * when present the column order is read from it, otherwise the first field is
 * the text and the second is the file name. (The Turkish column names are the
 * user-facing CSV contract — do not translate.)
 *
 * Row numbers in error messages are the CSV lines the user sees
 * (header included, 1-based).
 */
export function parseRows(content: string): Row[] {
  const raw = parseCsv(content);
  if (raw.length === 0) return [];

  const header = raw[0].map((column) => column.trim().toLowerCase());
  // The header is only recognized when BOTH column names are present. A looser
  // rule (e.g. assume a typo when only one column matches) requires guessing —
  // and a wrong guess rejects valid data: a user whose first variation is
  // exactly the word "metin", or whose first file name is exactly "dosya_adi",
  // would lose their list. The ambiguity cannot be resolved; counting it as a
  // data row and letting the user see it in the table is less bad than
  // guessing and rejecting good data.
  const hasHeader = header.includes('metin') && header.includes('dosya_adi');

  const textIdx = hasHeader ? header.indexOf('metin') : 0;
  const fileIdx = hasHeader ? header.indexOf('dosya_adi') : 1;
  const firstData = hasHeader ? 1 : 0;

  const rows: Row[] = [];
  const seenNames = new Set<string>();

  for (let i = firstData; i < raw.length; i++) {
    const metin = (raw[i][textIdx] ?? '').trim();
    const dosyaAdi = sanitizeFileName(raw[i][fileIdx] ?? '');

    if (metin === '' || dosyaAdi === '') {
      throw new Error(`${i + 1}. satır: "metin" ve "dosya_adi" boş olamaz`);
    }
    if (seenNames.has(dosyaAdi)) {
      throw new Error(`${i + 1}. satır: "${dosyaAdi}" dosya adı tekrar ediyor`);
    }
    seenNames.add(dosyaAdi);
    rows.push({ metin, dosyaAdi });
  }
  return rows;
}
