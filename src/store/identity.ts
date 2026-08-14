import { randomBytes } from 'node:crypto';

/** Turkish letters must still map to ASCII after `toLowerCase`. */
const TURKISH_LETTERS: Record<string, string> = {
  ç: 'c', ğ: 'g', ı: 'i', i̇: 'i', ö: 'o', ş: 's', ü: 'u',
};

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Makes a project name usable as a file and folder name.
 * An empty result becomes "proje" — a name made entirely of punctuation
 * would otherwise produce the file name `.json`.
 */
export function slugify(name: string): string {
  const lower = name.toLowerCase();
  // The locale-independent lowercase of 'İ' is not one character but two code
  // points: 'i' + combining dot above (U+0307). A per-code-point mapping cannot
  // catch that, so we collapse it to a single character before the spread below.
  const merged = lower.replace(/i̇/g, TURKISH_LETTERS['i̇']);
  const ascii = [...merged].map((letter) => TURKISH_LETTERS[letter] ?? letter).join('');

  const slug = ascii
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');

  return slug === '' ? 'proje' : slug;
}

/**
 * Generates an id shaped `<slug>-<4 hex>`. The hex suffix keeps two projects
 * with the same name from clashing; `exists` checks for collisions.
 *
 * @param makeHex Test injection point. Default: 2 random bytes.
 */
export function generateId(
  name: string,
  exists: (id: string) => boolean,
  makeHex: () => string = () => randomBytes(2).toString('hex'),
): string {
  const base = slugify(name);
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = `${base}-${makeHex()}`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error(`"${name}" için benzersiz id üretilemedi`);
}

/**
 * The `:id` URL parameter ends up in a file path, so this filter is mandatory:
 * dots, slashes and uppercase are rejected, which is why `..` can never pass.
 */
export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}
