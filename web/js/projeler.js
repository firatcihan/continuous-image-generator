import { api } from './api.js';
import { durum, guncelle, projeCalisiyorMu } from './durum.js';
import { galeriyiYukle } from './galeri.js';
import { bekleyeniBosalt } from './kaydet.js';

const $ = (id) => document.getElementById(id);

export async function projeleriYukle() {
  const liste = await api.projeler();
  guncelle({ projeler: liste.projeler, bozukSayisi: liste.bozukSayisi });
}

/** Satırlar ayrı tutulur: liste.js onları düzenler, editor.js oradan okur. */
async function projeUygula(proje) {
  guncelle({
    aktifProje: proje,
    satirlar: proje.satirlar.map((s) => ({ ...s })),
    satirGecerli: true,
    hata: null,
  });
  if (location.hash !== `#/proje/${proje.id}`) location.hash = `#/proje/${proje.id}`;
  // Galeri burada yükleniyor, `projeSec`'in gövdesinde değil: kurtarma yolu da
  // (404 sonrası ilk projeye düşme) buradan geçiyor, yoksa o yolda galeri
  // silinmiş projenin görselleriyle ekranda kalırdı.
  await galeriyiYukle(proje.id);
}

/** Aktif projeyi yükler ve hash'i eşitler. id null ise boş duruma geçer. */
export async function projeSec(id) {
  // Bekleyen otomatik kaydetme varsa debounce beklemeden yaz — proje
  // değiştirirken değişiklik kaybolmasın.
  await bekleyeniBosalt();
  if (id === null) {
    guncelle({ aktifProje: null });
    await galeriyiYukle(null);
    return;
  }
  try {
    await projeUygula(await api.proje(id));
  } catch (hata) {
    // Bilinmeyen id (404): hash'i temizle, listeyi TAZELEYİP tek seferlik ilk
    // projeye düş — bir yenileme + bir tek yeniden deneme, o da olmazsa boş
    // duruma in. ESKİ sürüm burada `projeSec`'i kendi kendine çağırıyordu;
    // liste hiç tazelenmediği için "ilk proje" bayat kalıyor ve bulunamayan
    // id her seferinde AYNI hataya düşüp API'yi geri kapamasız (backoff'suz),
    // sınırsız bir döngüde dövüyordu. Tek deneme + geri dönüş yok kuralı
    // bunu kapatıyor.
    //
    // `projeleriYukle()` ve tek yeniden deneme İÇ bir try/catch'e alınmış
    // olmalı: `api.projeler()`/`api.proje()` süresi dolmuş bir oturum
    // çerezinde (401) ya da kopan bağlantıda da fırlatabilir. Bu fırlatma
    // dıştaki `catch`'in DIŞINA sızarsa `projeSec`'in döndürdüğü promise
    // reddedilir; çoğu çağrı yeri fire-and-forget olduğu için
    // (`projeler.js`'teki `() => void projeSec(...)`, `uygulama.js`'teki
    // `() => void yonlendir()`) bu YAKALANMAMIŞ BİR REDDETME olarak
    // görünürdü, kullanıcıya hiç ulaşmadan; `baslat()`'ta ise `await
    // yonlendir()` fırlatırsa sondaki `projeleriCiz()` hiç çalışmaz, sayfa
    // yarım kalırdı. Bu yüzden burada da fırlayan HER ŞEY aynı temiz uç
    // duruma iniyor: proje yok, hash yok, hata görünür.
    guncelle({ aktifProje: null, hata: hata.message });
    location.hash = '';
    try {
      await projeleriYukle();
      const ilk = durum.projeler[0];
      if (ilk === undefined) return;
      await projeUygula(await api.proje(ilk.id));
    } catch (kurtarmaHatasi) {
      guncelle({ aktifProje: null, hata: kurtarmaHatasi.message });
    }
  }
}

export function projeleriCiz() {
  const kap = $('projeListesi');

  // Listeyi yeniden çizerken açık bir yeni-proje girdisi varsa onu koru —
  // aksi halde her guncelle() kullanıcının yazdığı adı silerdi. Yalnızca
  // HENÜZ GÖNDERİLMEMİŞ (disabled olmayan) girdi "açık" sayılır: olustur()
  // bir isteği gönderirken girdiyi disabled yapar, böylece o an devam eden
  // bir gönderim burada "yeniden açılacak taslak" sanılıp az sonra hayalet
  // bir satır olarak geri getirilmez (bkz. projeler.js'teki yeniProjeSatiriAc
  // yorumu).
  const acikGirdi = kap.querySelector('.yeni-proje-girdisi:not(:disabled)');
  const acikDeger = acikGirdi === null ? null : acikGirdi.value;
  kap.textContent = '';

  for (const ozet of durum.projeler) {
    const satir = document.createElement('div');
    satir.className = 'proje-satiri';
    if (durum.aktifProje && durum.aktifProje.id === ozet.id) satir.classList.add('aktif');

    const ad = document.createElement('span');
    ad.className = 'ad';
    ad.textContent = ozet.ad;
    satir.append(ad);

    if (projeCalisiyorMu(ozet.id)) {
      const isaret = document.createElement('span');
      isaret.className = 'calisiyor';
      isaret.textContent = '▶';
      satir.append(isaret);
    }

    const sayi = document.createElement('span');
    sayi.className = 'sayi';
    sayi.textContent = String(ozet.satirSayisi);
    satir.append(sayi);

    const sil = document.createElement('button');
    sil.className = 'sil';
    sil.textContent = '×';
    sil.title = 'Projeyi sil';
    sil.addEventListener('click', (olay) => {
      olay.stopPropagation();
      document.dispatchEvent(new CustomEvent('proje-sil-istegi', { detail: ozet }));
    });
    satir.append(sil);

    satir.addEventListener('click', () => void projeSec(ozet.id));
    kap.append(satir);
  }

  const uyari = $('bozukUyari');
  uyari.hidden = durum.bozukSayisi === 0;
  uyari.textContent =
    `${durum.bozukSayisi} proje dosyası okunamadı ve ".bozuk" olarak kenara alındı.`;

  $('bosDurum').hidden = durum.projeler.length > 0;
  $('projeEkrani').hidden = durum.aktifProje === null;
  $('projeAdi').textContent = durum.aktifProje ? durum.aktifProje.ad : '—';

  if (acikDeger !== null) {
    yeniProjeSatiriAc();
    kap.querySelector('.yeni-proje-girdisi').value = acikDeger;
  }
}

/**
 * Sol panelin sonunda düzenlenebilir boş bir satır açar: Enter oluşturur,
 * Esc veya boş bırakıp odak kaybı iptal eder. Ayrı form ekranı yok —
 * "ad yaz, gerisi otomatik" kararının karşılığı.
 *
 * `olustur()`'ün başındaki koruma önemli: girdiyi `disabled` yapmak (Enter
 * yolu) ya da satırı DOM'dan kaldırmak (Esc/boş-blur yolu) tarayıcıda ODAK
 * KAYBINI (blur) senkron olarak TETİKLER — bu da aynı `olustur()`'ü ikinci
 * kez, kendi kendine çağırır. Koruma yoksa: Enter'a basmak `disabled = true`
 * satırının hemen ardından ikinci bir `api.projeOlustur` çağrısı yapar ve
 * AYNI PROJE İKİ KEZ oluşur; Esc'e basmak `satir.remove()`'un tetiklediği
 * blur ile "iptal" niyetini görmezden gelip projeyi yine de oluşturur.
 * `kapandi` bunların ikisini de keser. `girdi.isConnected` ayrıca satırın
 * ilgisiz bir `projeleriCiz()` çağrısıyla (ör. başka bir olayın tetiklediği
 * yeniden çizim) DOM'dan koparıldığı durumu yakalar: o zaman girdi hâlâ
 * `kapandi = false` olabilir ama artık belgede değildir — bu durumda
 * gönderim yapmadan çıkarız, metin yukarıdaki "açık girdiyi koru" mantığıyla
 * yeni bir satırda korunur.
 *
 * `olustur()`'ün `catch` bloğu, `api.projeOlustur` reddedince AYNI satırı
 * hiçbir zaman yeniden kullanmaz — yalnızca `guncelle({ hata })` çağırması
 * bile `projeleriCiz()`'i tetikler ve o, `#projeListesi`'ni koşulsuz söker;
 * "korunan" bir girdi de eski düğüm olarak değil, taze bir ikizi olarak geri
 * gelir. Yani orijinal `girdi` o noktada zaten belgede değildir — `catch`
 * doğrudan `yeniProjeSatiriAc()` ile taze bir satır açıp yazılan adı oraya
 * taşır.
 */
export function yeniProjeSatiriAc() {
  const kap = $('projeListesi');
  if (kap.querySelector('.yeni-proje-girdisi') !== null) {
    kap.querySelector('.yeni-proje-girdisi').focus();
    return;
  }

  const satir = document.createElement('div');
  satir.className = 'proje-satiri';

  const girdi = document.createElement('input');
  girdi.type = 'text';
  girdi.className = 'yeni-proje-girdisi';
  girdi.placeholder = 'Proje adı…';

  let kapandi = false;
  const kapat = () => {
    if (kapandi) return;
    kapandi = true;
    satir.remove();
  };

  const olustur = async () => {
    if (kapandi || !girdi.isConnected) return;
    const ad = girdi.value.trim();
    if (ad === '') {
      kapat();
      return;
    }
    kapandi = true; // yeniden çizim satırı zaten kaldıracak
    girdi.disabled = true;
    try {
      const proje = await api.projeOlustur(ad);
      await projeleriYukle();
      await projeSec(proje.id);
    } catch (hata) {
      // `guncelle({ hata })` az önce `projeleriCiz()`'i (ona abone olan tek
      // dinleyici) tetikledi ve o, `kap.textContent = ''` ile #projeListesi'nin
      // TÜM çocuklarını KOŞULSUZ söker — bu satırın disabled olup olmaması
      // fark etmez, "korunan" bir girdi bile eski düğüm olarak değil, taze
      // bir ikizi olarak geri gelir (bkz. projeleriCiz). Yani bu noktada
      // orijinal `girdi` HİÇBİR ZAMAN belgede kalmıyor; ona `focus()` çağıran
      // bir "aynı satırı yeniden kullan" dalı hiçbir zaman çalışmazdı (ölü
      // kod olurdu). Bunun yerine tek yol: taze bir satır aç, yazılan adı
      // oraya taşı.
      guncelle({ hata: hata.message });
      yeniProjeSatiriAc();
      const yeni = $('projeListesi').querySelector('.yeni-proje-girdisi');
      if (yeni !== null) yeni.value = ad;
    }
  };

  girdi.addEventListener('keydown', (olay) => {
    if (olay.key === 'Enter') {
      olay.preventDefault();
      void olustur();
    } else if (olay.key === 'Escape') {
      olay.preventDefault();
      kapat();
    }
  });
  girdi.addEventListener('blur', () => void olustur());

  satir.append(girdi);
  kap.append(satir);
  girdi.focus();
}
