/**
 * ChatGPT'nin geçici/genel hata mesajları.
 *
 * Bunlar rate limit de değil, içerik reddi de değil — sunucu tarafı bir aksaklık.
 * Ayrı ele alınmalarının sebebi: tanınmazlarsa program görsel bekleyerek
 * `uretimZamanAsimiSn` (varsayılan 180 sn) boyunca oyalanır ve her satır için
 * bu süre `tekrarDenemeSayisi` kadar tekrarlanır. Tanındığında saniyeler içinde
 * anlaşılıp kısa bir beklemeyle yeniden denenir.
 *
 * Kalıplar bilerek dar tutuldu: rate limit ve içerik reddi mesajlarıyla
 * çakışmamalı, onların kendi ele alınma yolları var.
 */
const GECICI_HATA_KALIPLARI = [
  /bir şeyler ters gitti/i,
  /something went wrong/i,
  /an error occurred/i,
  /bir hata oluştu/i,
  /oluşturulamadı.*yeniden dene/i,
  /failed to generate/i,
];

/**
 * Türkçe büyük `İ` (U+0130) küçültülünce `i` + birleşen nokta üretir ve
 * regex'in `i` bayrağı bunu düz `i` ile eşleştiremez. Metni hem Türkçe hem
 * invariant kurallarla küçültüp ikisine de bakıyoruz: Türkçe küçültme `İ`yi
 * çözer, invariant küçültme İngilizce `I`nın `ı`ya dönüp bozulmasını önler.
 */
function karsilastirmaMetni(metin: string): string {
  return `${metin.toLocaleLowerCase('tr')}\n${metin.toLowerCase()}`;
}

export function geciciHataAlgila(metin: string): boolean {
  const aday = karsilastirmaMetni(metin);
  return GECICI_HATA_KALIPLARI.some((kalip) => kalip.test(aday));
}
