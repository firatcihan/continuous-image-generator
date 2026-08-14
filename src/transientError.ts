/**
 * ChatGPT's transient/generic error messages.
 *
 * These are neither rate limits nor content refusals — they are server-side
 * hiccups. They get special handling because if they went unrecognized the
 * program would idle waiting for an image for `uretimZamanAsimiSn` (default
 * 180 s), repeated `tekrarDenemeSayisi` times per row. Recognized, they are
 * understood within seconds and retried after a short wait.
 *
 * The patterns are deliberately narrow: they must not overlap with rate-limit
 * or refusal messages, which have their own handling paths.
 */
const TRANSIENT_ERROR_PATTERNS = [
  /bir şeyler ters gitti/i,
  /something went wrong/i,
  /an error occurred/i,
  /bir hata oluştu/i,
  /oluşturulamadı.*yeniden dene/i,
  /failed to generate/i,
];

/**
 * Turkish capital `İ` (U+0130) lowercases to `i` + combining dot, which the
 * regex `i` flag cannot match against a plain `i`. We lowercase the text with
 * both Turkish and invariant rules and check both: Turkish lowercasing
 * resolves `İ`, invariant lowercasing prevents English `I` from turning into
 * `ı` and breaking.
 */
function comparisonText(text: string): string {
  return `${text.toLocaleLowerCase('tr')}\n${text.toLowerCase()}`;
}

export function detectTransientError(text: string): boolean {
  const candidate = comparisonText(text);
  return TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(candidate));
}
