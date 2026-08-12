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
 * "Kuşak" sayacı — kullanıcının en son bıraktığı forma mı, yoksa artık
 * ekrandan kaybolmuş DAHA ESKİ bir forma mı ait olduğunu ayırt etmek için.
 * Hem yeni bir kayıt planlandığında (`kaydetmeyiPlanla`) hem de bir alan
 * geçersiz olduğunda (`gecersizIsaretle`) artar — ikisi de "kullanıcı formu
 * değiştirdi" anlamına gelir.
 *
 * Neden gerekli: bir yazma isteği sonuçlandığında (`yaz`), o istek ATILDIĞI
 * ANDAKİ form durumunu anlatır. Ağ isteği sürerken kullanıcı forma dokunmuş
 * olabilir (yeni bir düzenleme yapmış ya da alanı geçersiz hale getirmiş
 * olabilir) — bu durumda sonuçlanan istek artık kullanıcının O AN gördüğü
 * durumdan DAHA ESKİ bir anı anlatıyor demektir. Yalnızca GÖSTERGE alanları
 * (`kaydetDurumu`/`kaydetZamani`/`hata`) bu sayaç değişmemişse yazılır;
 * `aktifProje` her zaman birleştirilir (sunucunun damgaladığı
 * `guncellemeTarihi` kaybolmasın diye) ama bu birleştirme yalnızca `id`
 * değişmediği sürece hiçbir alan değerini yeniden yazmayan `editoruCiz`'in
 * `cizilenProjeId` koruması sayesinde güvenlidir.
 */
let surum = 0;

/**
 * Otomatik kaydetme. Açık "Kaydet" butonu çok projede veri kaybı tuzağıydı:
 * düzenle → başka projeye tıkla → değişiklik sessizce giderdi.
 *
 * Yalnızca DOĞRULAMAYI GEÇEN durum buraya gelir; geçersizken çağıran
 * `gecersizIsaretle()` kullanır ve hiç yazma planlanmaz.
 */
export function kaydetmeyiPlanla(proje) {
  bekleyen = proje;
  surum++;
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
  // Bu yazma isteğinin ait olduğu kuşak — istek sonuçlandığında hâlâ
  // güncel mi diye buna bakılacak.
  const buSurum = surum;

  guncelle({ kaydetDurumu: 'kaydediliyor' });
  try {
    const yazilan = await api.projeKaydet(proje.id, proje);
    if (buSurum === surum) {
      // Aradan yeni bir kullanıcı girdisi geçmedi: bu yazma hâlâ ekranda
      // görünen en güncel form durumunu anlatıyor, gösterge güncellenebilir.
      guncelle({
        aktifProje: yazilan,
        kaydetDurumu: 'kaydedildi',
        kaydetZamani: new Date().toLocaleTimeString('tr-TR'),
        hata: null,
      });
    } else {
      // Kullanıcı bu yazma sürerken forma dokundu (yeni bir kayıt planladı
      // ya da alanı geçersiz yaptı) — gösterge artık ONUN durumuna ait,
      // bu ESKİ yazmanın "kaydedildi" damgasıyla ezilmemeli. Yine de
      // sunucunun döndürdüğü `guncellemeTarihi` kaybolmasın diye
      // `aktifProje` birleştiriliyor; bu güvenli çünkü `editoruCiz`
      // yalnızca proje `id`si değiştiğinde alan değeri yazıyor (id burada
      // değişmedi), yani kullanıcının o an yazmakta olduğu karakterlere
      // dokunulmuyor.
      guncelle({ aktifProje: yazilan });
    }
    await projeleriYukle(); // sol paneldeki ad ve satır sayısı tazelenir
  } catch (hata) {
    // Aynı mantık ters yönde: bu yazma artık eskiyse, başarısızlığı da
    // göstergeye yazma — daha yeni bir "geçersiz" ya da (bir sonraki yazma
    // sonuçlandığında) "kaydedildi" durumunun üstüne binmesin.
    if (buSurum === surum) {
      guncelle({ kaydetDurumu: 'gecersiz', hata: hata.message });
    }
  }
}

export function gecersizIsaretle(sebep) {
  if (zamanlayici !== null) {
    clearTimeout(zamanlayici);
    zamanlayici = null;
  }
  bekleyen = null;
  surum++;
  guncelle({ kaydetDurumu: 'gecersiz', hata: sebep });
}
