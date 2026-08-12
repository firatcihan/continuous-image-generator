import { randomBytes } from 'node:crypto';

/** Türkçe harfler `toLowerCase` sonrası da ASCII'ye çevrilmeli. */
const TURKCE_HARFLER: Record<string, string> = {
  ç: 'c', ğ: 'g', ı: 'i', i̇: 'i', ö: 'o', ş: 's', ü: 'u',
};

const ID_KALIBI = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Proje adını dosya adı ve klasör adı olarak kullanılabilir hale getirir.
 * Boş sonuç "proje" olur — adı tamamen noktalamadan oluşan bir proje
 * yoksa dosya adı `.json` olurdu.
 */
export function slugla(ad: string): string {
  const kucuk = ad.toLowerCase();
  // 'İ'nin yerel-bağımsız küçük harf hâli tek karakter değil, iki kod noktasıdır:
  // 'i' + inceltme işareti (U+0307). Tek tek kod noktası eşlemesi bunu yakalayamaz,
  // bu yüzden aşağıdaki spread'den önce tek karaktere indiriyoruz.
  const birlesmis = kucuk.replace(/i̇/g, TURKCE_HARFLER['i̇']);
  const asciiye = [...birlesmis].map((harf) => TURKCE_HARFLER[harf] ?? harf).join('');

  const slug = asciiye
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');

  return slug === '' ? 'proje' : slug;
}

/**
 * `<slug>-<4 hex>` biçiminde id üretir. Aynı adlı iki proje çakışmasın diye
 * hex eki var; `varMi` ile çakışma kontrol edilir.
 *
 * @param hexUret Test enjeksiyonu için. Varsayılan: rastgele 2 bayt.
 */
export function idUret(
  ad: string,
  varMi: (id: string) => boolean,
  hexUret: () => string = () => randomBytes(2).toString('hex'),
): string {
  const taban = slugla(ad);
  for (let deneme = 0; deneme < 50; deneme++) {
    const aday = `${taban}-${hexUret()}`;
    if (!varMi(aday)) return aday;
  }
  throw new Error(`"${ad}" için benzersiz id üretilemedi`);
}

/**
 * `:id` URL parametresi dosya yoluna girdiği için zorunlu süzgeç:
 * nokta, eğik çizgi ve büyük harf kabul edilmez, `..` bu yüzden geçemez.
 */
export function idGecerliMi(id: string): boolean {
  return ID_KALIBI.test(id);
}
