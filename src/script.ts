import { dosyaAdiTemizle } from './liste.js';
import type { Satir } from './tipler.js';

/**
 * Yalnızca parantez ya da köşeli parantez içindeki damga. Çıplak `9:30`
 * KASITLA dışarıda: konuşma metninde geçen "saat 9:30'da" scripti yanlış
 * yerden bölerdi.
 */
const DAMGA = /[(\[]\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[)\]]/g;

/**
 * Zaman damgalı script'i satırlara çevirir. Damga **i**'den ÖNCEKİ parça damga
 * **i** ile adlanır — kullanıcı görselin videoda hangi ana kadar süreceğini
 * dosya adından okuyor. Son damgadan sonraki parçayı bitiren bir damga yok;
 * `_son` eki hem onu adlandırır hem de aynı damgayla çakışmasını önler.
 */
export function scriptiSatirlaraCevir(icerik: string): Satir[] {
  const damgalar = [...icerik.matchAll(DAMGA)].map((eslesme) => ({
    deger: eslesme[1],
    bas: eslesme.index ?? 0,
    son: (eslesme.index ?? 0) + eslesme[0].length,
  }));
  if (damgalar.length === 0) {
    throw new Error('Script içinde (0:00) biçiminde zaman damgası bulunamadı');
  }

  const parcalar: { metin: string; ad: string }[] = [];
  let imlec = 0;
  for (const damga of damgalar) {
    parcalar.push({ metin: icerik.slice(imlec, damga.bas), ad: damga.deger });
    imlec = damga.son;
  }
  const sonDamga = damgalar[damgalar.length - 1].deger;
  parcalar.push({ metin: icerik.slice(imlec), ad: `${sonDamga}_son` });

  const satirlar: Satir[] = [];
  const gorulen = new Map<string, number>();
  for (const parca of parcalar) {
    const metin = bosluklariSikistir(parca.metin);
    if (metin === '') continue; // iki ardışık damga arası boş — satır üretmez
    satirlar.push({ metin, dosyaAdi: tekilAd(dosyaAdiTemizle(parca.ad), gorulen) });
  }
  if (satirlar.length === 0) throw new Error('Script içinde çevrilecek metin yok');
  return satirlar;
}

/** Metin `{VARYASYON}` yerine geçip prompt kutusuna yazılıyor; satır sonunun orada anlamı yok. */
function bosluklariSikistir(metin: string): string {
  return metin.replace(/\s+/g, ' ').trim();
}

/**
 * Aynı damga iki kez geçerse ikinci ad `_2` olur. Tekrar eden dosya adı kaydı
 * 400'e düşürürdü; kullanıcı da hangi satırı elle değiştireceğini bilemezdi.
 */
function tekilAd(ad: string, gorulen: Map<string, number>): string {
  const adet = (gorulen.get(ad) ?? 0) + 1;
  gorulen.set(ad, adet);
  return adet === 1 ? ad : `${ad}_${adet}`;
}
