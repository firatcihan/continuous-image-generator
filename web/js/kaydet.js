import { api } from './api.js';
import { guncelle } from './durum.js';
import { projeleriYukle } from './projeler.js';

const GECIKME_MS = 800;

let zamanlayici = null;
let bekleyen = null;
/**
 * O an sürmekte olan yazma isteğinin sözü (yoksa null).
 *
 * `bekleyeniBosalt` iki farklı yerden EŞ ZAMANLI çağrılabilir: debounce
 * zamanlayıcısı kendi kendine ateşlerken kullanıcı başka bir projeye tıklayıp
 * `projeler.js`'teki `projeSec`'in üzerinden de çağırabilir. Bu değişken
 * olmadan ikinci çağrı `bekleyen`i (ilk çağrı zaten sıfırlamış olduğu için)
 * `null` görüp hiç beklemeden döner — `projeSec` bunu "kaydedilecek bir şey
 * yok" sanıp hemen yeni projeye geçer, ardından ilk çağrının ağ isteği
 * sonuçlanınca `guncelle({ aktifProje: ... })` YENİ projenin üstüne ESKİ
 * projenin verisini yazar. `devamEden` bu ikinci çağrıyı ilkinin bitişine
 * kadar bekleterek `projeSec`'in geçişi ancak yazma tamamlandıktan sonra
 * sürdürmesini sağlar.
 */
let devamEden = null;

/**
 * Otomatik kaydetme. Açık "Kaydet" butonu çok projede veri kaybı tuzağıydı:
 * düzenle → başka projeye tıkla → değişiklik sessizce giderdi.
 *
 * Yalnızca DOĞRULAMAYI GEÇEN durum buraya gelir; geçersizken çağıran
 * `gecersizIsaretle()` kullanır ve hiç yazma planlanmaz.
 */
export function kaydetmeyiPlanla(proje) {
  bekleyen = proje;
  if (zamanlayici !== null) clearTimeout(zamanlayici);
  zamanlayici = setTimeout(() => void bekleyeniBosalt(), GECIKME_MS);
}

/** Bekleyen kaydı hemen yazar — proje değiştirirken debounce beklenmez. */
export async function bekleyeniBosalt() {
  // Zaten süren bir yazma varsa önce onun bitmesini bekle (yukarıdaki not).
  if (devamEden !== null) await devamEden;

  if (zamanlayici !== null) {
    clearTimeout(zamanlayici);
    zamanlayici = null;
  }
  const proje = bekleyen;
  bekleyen = null;
  if (proje === null) return;

  devamEden = yaz(proje);
  try {
    await devamEden;
  } finally {
    devamEden = null;
  }
}

async function yaz(proje) {
  guncelle({ kaydetDurumu: 'kaydediliyor' });
  try {
    const yazilan = await api.projeKaydet(proje.id, proje);
    guncelle({
      aktifProje: yazilan,
      kaydetDurumu: 'kaydedildi',
      kaydetZamani: new Date().toLocaleTimeString('tr-TR'),
      hata: null,
    });
    await projeleriYukle(); // sol paneldeki ad ve satır sayısı tazelenir
  } catch (hata) {
    guncelle({ kaydetDurumu: 'gecersiz', hata: hata.message });
  }
}

export function gecersizIsaretle(sebep) {
  if (zamanlayici !== null) {
    clearTimeout(zamanlayici);
    zamanlayici = null;
  }
  bekleyen = null;
  guncelle({ kaydetDurumu: 'gecersiz', hata: sebep });
}
