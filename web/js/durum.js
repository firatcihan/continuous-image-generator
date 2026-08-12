/** Tek istemci durumu. Render fonksiyonları abone olur, guncelle() tetikler. */
export const durum = {
  projeler: [],
  bozukSayisi: 0,
  aktifProje: null,
  /**
   * Düzenlenen satırlar. Tek gerçek kaynak burası: `liste.js` yazar,
   * `editor.js` okur. Böylece iki modül arasında import döngüsü olmaz.
   */
  satirlar: [],
  /** CSV modunda ayrıştırma başarısızsa false — geçersizken kayıt planlanmaz. */
  satirGecerli: true,
  is: {
    durum: 'bosta',
    projeId: null,
    sira: 0,
    toplam: 0,
    ozet: { basarili: 0, atlanan: 0, basarisiz: 0 },
    kalanSn: null,
    mesaj: null,
  },
  galeri: { dosyalar: [], toplamBayt: 0 },
  tarayiciAcik: false,
  /** 'bosta' | 'kaydediliyor' | 'kaydedildi' | 'gecersiz' */
  kaydetDurumu: 'bosta',
  kaydetZamani: null,
  akisBagli: false,
  hata: null,
};

const dinleyiciler = new Set();

export function abone(dinleyici) {
  dinleyiciler.add(dinleyici);
  return () => dinleyiciler.delete(dinleyici);
}

export function guncelle(parca) {
  Object.assign(durum, parca);
  for (const dinleyici of dinleyiciler) dinleyici(durum);
}

/** İş bu projede mi çalışıyor? Salt-okunur kilidi ve şerit buna bakar. */
export function projeCalisiyorMu(projeId) {
  const mesgul = ['calisiyor', 'duraklatildi', 'limitBekliyor', 'kullaniciBekliyor'];
  return mesgul.includes(durum.is.durum) && durum.is.projeId === projeId;
}

export function isMesgulMu() {
  const mesgul = ['calisiyor', 'duraklatildi', 'limitBekliyor', 'kullaniciBekliyor'];
  return mesgul.includes(durum.is.durum);
}
