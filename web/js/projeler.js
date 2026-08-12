import { api } from './api.js';
import { durum, guncelle, projeCalisiyorMu } from './durum.js';

const $ = (id) => document.getElementById(id);

export async function projeleriYukle() {
  const liste = await api.projeler();
  guncelle({ projeler: liste.projeler, bozukSayisi: liste.bozukSayisi });
}

/** Aktif projeyi yükler ve hash'i eşitler. id null ise boş duruma geçer. */
export async function projeSec(id) {
  if (id === null) {
    guncelle({ aktifProje: null, galeri: { dosyalar: [], toplamBayt: 0 } });
    return;
  }
  try {
    const proje = await api.proje(id);
    // Satırlar ayrı tutulur: liste.js onları düzenler, editor.js oradan okur
    guncelle({
      aktifProje: proje,
      satirlar: proje.satirlar.map((s) => ({ ...s })),
      satirGecerli: true,
      hata: null,
    });
    if (location.hash !== `#/proje/${id}`) location.hash = `#/proje/${id}`;
  } catch (hata) {
    // Bilinmeyen id (404): hash'i temizle, ilk projeye düş
    guncelle({ aktifProje: null, hata: hata.message });
    location.hash = '';
    const ilk = durum.projeler[0];
    if (ilk) await projeSec(ilk.id);
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
      guncelle({ hata: hata.message });
      kapandi = false;
      girdi.disabled = false;
      girdi.focus();
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
