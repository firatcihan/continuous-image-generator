import type { Satir } from './tipler.js';

/** Tırnaklı alan ve CRLF destekli mini CSV ayrıştırıcı. */
export function csvAyristir(icerik: string): string[][] {
  const satirlar: string[][] = [];
  let alanlar: string[] = [];
  let alan = '';
  let tirnakIcinde = false;

  const satiriBitir = () => {
    alanlar.push(alan);
    alan = '';
    if (alanlar.some((a) => a.trim() !== '')) satirlar.push(alanlar);
    alanlar = [];
  };

  for (let i = 0; i < icerik.length; i++) {
    const karakter = icerik[i];
    if (tirnakIcinde) {
      if (karakter === '"') {
        if (icerik[i + 1] === '"') {
          alan += '"';
          i++;
        } else {
          tirnakIcinde = false;
        }
      } else {
        alan += karakter;
      }
    } else if (karakter === '"') {
      tirnakIcinde = true;
    } else if (karakter === ',') {
      alanlar.push(alan);
      alan = '';
    } else if (karakter === '\n' || karakter === '\r') {
      if (karakter === '\r' && icerik[i + 1] === '\n') i++;
      satiriBitir();
    } else {
      alan += karakter;
    }
  }
  satiriBitir();
  return satirlar;
}

export function dosyaAdiTemizle(ad: string): string {
  return ad
    .trim()
    .replace(/\.png$/i, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();
}

/**
 * `metin,dosya_adi` CSV metnini satırlara çevirir. Başlık satırı isteğe
 * bağlı: varsa sütun sırası başlıktan okunur, yoksa ilk alan metin, ikinci
 * alan dosya adı sayılır.
 *
 * Hata mesajlarındaki satır numarası kullanıcının gördüğü CSV satırıdır
 * (başlık dahil, 1'den başlar).
 */
export function satirlariAyristir(icerik: string): Satir[] {
  const ham = csvAyristir(icerik);
  if (ham.length === 0) return [];

  const baslik = ham[0].map((sutun) => sutun.trim().toLowerCase());
  const metinVar = baslik.includes('metin');
  const dosyaAdiVar = baslik.includes('dosya_adi');
  // Yalnızca biri varsa yazım hatası ("dosyaadi" gibi) demektir — ilk satırı
  // sessizce veri sayıp kullanıcıya bozuk bir ilk satır göstermek yerine,
  // eksik sütunu açıkça bildir.
  if (metinVar !== dosyaAdiVar) {
    throw new Error('başlık satırı "metin,dosya_adi" sütunlarını içermeli');
  }
  const basliklidir = metinVar && dosyaAdiVar;

  const metinIdx = basliklidir ? baslik.indexOf('metin') : 0;
  const dosyaIdx = basliklidir ? baslik.indexOf('dosya_adi') : 1;
  const ilkVeri = basliklidir ? 1 : 0;

  const satirlar: Satir[] = [];
  const gorulenAdlar = new Set<string>();

  for (let i = ilkVeri; i < ham.length; i++) {
    const metin = (ham[i][metinIdx] ?? '').trim();
    const dosyaAdi = dosyaAdiTemizle(ham[i][dosyaIdx] ?? '');

    if (metin === '' || dosyaAdi === '') {
      throw new Error(`${i + 1}. satır: "metin" ve "dosya_adi" boş olamaz`);
    }
    if (gorulenAdlar.has(dosyaAdi)) {
      throw new Error(`${i + 1}. satır: "${dosyaAdi}" dosya adı tekrar ediyor`);
    }
    gorulenAdlar.add(dosyaAdi);
    satirlar.push({ metin, dosyaAdi });
  }
  return satirlar;
}
