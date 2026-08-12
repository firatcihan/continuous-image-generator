import { api } from './api.js';
import { durum, guncelle } from './durum.js';
import { degisiklikBildir } from './editor.js';

const $ = (id) => document.getElementById(id);

/** Tablo mu CSV mi düzenleniyor. */
let csvModu = false;

/**
 * CSV ayrıştırma "kuşak" sayacı. Her tuş vuruşu sunucuya bir ayrıştırma
 * isteği atıyor; yanıtlar SIRAYLA gelmek zorunda değil. Sayaç olmadan:
 * kullanıcı "a" sonra "b" yazar, B'nin yanıtı A'dan önce döner, ardından
 * A'nın yanıtı `durum.satirlar`ı ESKİ metnin satırlarıyla ezer ve o eski
 * hâl otomatik kaydetmeye verilir — ekranda "ab" yazarken diske "a"nın
 * satırları gider. Sayaç eskiyen yanıtı sessizce atıyor.
 */
let csvSurum = 0;

/**
 * Satırların tek gerçek kaynağı `durum.satirlar`. Bu modül yazar, `editor.js`
 * okur — böylece iki modül arasında import döngüsü olmaz (import yönü tek:
 * liste → editor).
 */
const satirlar = () => durum.satirlar;

function satirlariYaz(yeni, gecerli = true) {
  guncelle({ satirlar: yeni, satirGecerli: gecerli });
}

/**
 * CSV modunda ayrıştırmayı sunucuya yaptırır. Ayrıştırma tarayıcıda
 * tekrarlanmıyor: iki kopya zamanla ayrışır ve kullanıcının CSV'si tarayıcıda
 * geçip sunucuda reddedilirdi.
 *
 * Döner: `'tamam'` (satırlar yazıldı), `'hata'` (+ mesaj, durum geçersiz
 * işaretlendi) ya da `'eski'` — bu istek sürerken daha yenisi başlamış,
 * çağıran hiçbir şey yapmamalı (ne satır yazmalı ne uyarı çizmeli).
 */
async function csvdenTazele() {
  const buSurum = ++csvSurum;
  try {
    const sonuc = await api.csvAyristir($('csvAlani').value);
    if (buSurum !== csvSurum) return { durum: 'eski' };
    satirlariYaz(sonuc.satirlar, true);
    return { durum: 'tamam' };
  } catch (hata) {
    if (buSurum !== csvSurum) return { durum: 'eski' };
    guncelle({ satirGecerli: false });
    return { durum: 'hata', mesaj: hata.message };
  }
}

/**
 * Satırları CSV metnine çevirir. Bu yön (serileştirme) tarayıcıda kalıyor:
 * ayrıştırma kurallarının aksine tek satırlık kaçış mantığı, sunucuya gidip
 * gelmeye değmez.
 */
function csveCevir(kayitlar) {
  const kacis = (alan) => (/[",\n]/.test(alan) ? `"${alan.replaceAll('"', '""')}"` : alan);
  return ['metin,dosya_adi', ...kayitlar.map((s) => `${kacis(s.metin)},${kacis(s.dosyaAdi)}`)]
    .join('\n');
}

/** Aktif proje değiştiğinde iç veriyi tazeler. */
export function listeyiCiz() {
  if (durum.aktifProje === null) {
    // Damgayı temizle: aynı id yeniden seçilirse (404 kurtarma yolu boş duruma
    // düşüp geri dönebiliyor) damga kalırsa tablo yeniden kurulmaz ve
    // `durum.satirlar` tazelenmiş olduğu hâlde ekranda eski satırlar kalırdı.
    $('tabloKabi').dataset.projeId = '';
    return;
  }

  // Kullanıcı yazarken tabloyu yeniden kurmak imleci kaybettirir; yalnızca
  // proje kimliği değiştiyse iç veri baştan yüklenir.
  if ($('tabloKabi').dataset.projeId !== durum.aktifProje.id) {
    $('tabloKabi').dataset.projeId = durum.aktifProje.id;
    csvModu = false;
    tabloyuCiz();
  }
  modKabuguCiz();
}

function modKabuguCiz() {
  $('tabloKabi').hidden = csvModu;
  $('csvAlani').hidden = !csvModu;
  $('btnSatirEkle').hidden = csvModu;
  $('btnCsvModu').textContent = csvModu ? 'Tablo olarak düzenle' : 'CSV olarak düzenle';
  $('satirSayisi').textContent = `(${satirlar().length})`;
}

function tabloyuCiz() {
  const kap = $('tabloKabi');
  kap.textContent = '';

  const tablo = document.createElement('table');
  tablo.className = 'satir-tablosu';
  const bas = document.createElement('tr');
  for (const baslik of ['Metin (varyasyon)', 'Dosya adı', '']) {
    const hucre = document.createElement('th');
    hucre.textContent = baslik;
    bas.append(hucre);
  }
  tablo.append(bas);

  satirlar().forEach((satir, sira) => {
    const tr = document.createElement('tr');

    for (const alan of ['metin', 'dosyaAdi']) {
      const td = document.createElement('td');
      const girdi = document.createElement('input');
      girdi.type = 'text';
      girdi.value = satir[alan];
      girdi.placeholder = alan === 'metin' ? 'kar yağarken dağ evinde' : 'dag_evi_kis';

      girdi.addEventListener('input', () => {
        // Diziyi yerinde değiştirip aynı referansı geri yazıyoruz: tabloyu
        // yeniden kurmadığımız için imleç yerinde kalır.
        const guncel = satirlar();
        guncel[sira][alan] = girdi.value;
        satirlariYaz(guncel, true);
        isaretleriTazele();
        void bildir();
      });
      td.append(girdi);
      tr.append(td);
    }

    const silHucre = document.createElement('td');
    silHucre.className = 'silme';
    const sil = document.createElement('button');
    sil.textContent = '×';
    sil.title = 'Satırı sil';
    sil.addEventListener('click', () => {
      const guncel = satirlar();
      guncel.splice(sira, 1);
      satirlariYaz(guncel, true);
      tabloyuCiz();
      modKabuguCiz();
      void bildir();
    });
    silHucre.append(sil);
    tr.append(silHucre);

    tablo.append(tr);
  });

  kap.append(tablo);
  // İşaretleri tek yerden hesapla: kurulum ile tuş vuruşu arasında kural
  // farkı kalmasın.
  isaretleriTazele();
}

/**
 * Kırmızı işaret ipucu için tekrar eden dosya adları.
 *
 * Adlar KIRPILARAK karşılaştırılıyor, hem sayımda hem sorguda: eskiden sayım
 * kırpılmış ada göre yapılırken sorgu HAM değerle atıldığı için `"a "` ile
 * `"a"` çiftinde yalnızca biri kırmızı oluyordu.
 *
 * Bu yalnızca bir İPUCU. Son sözü sunucu söylüyor: `dosyaAdiTemizle` ayrıca
 * sondaki `.png`'yi atıyor ve `\ / : * ? " < > |` karakterlerini `_` yapıyor,
 * yani `foo.png` ile `foo` sunucuda çakışır ama burada çakışmaz. O kuralları
 * buraya kopyalamıyoruz — spec'in CSV ayrıştırmayı tek yerde tutma kararıyla
 * aynı gerekçe: ikinci kopya zamanla ayrışır. Sunucu 400 döndüğünde gösterge
 * "Geçersiz — kaydedilmedi" der ve mesajda hangi satırın çakıştığı yazar.
 */
function tekrarlayanAdlar() {
  const sayim = new Map();
  for (const satir of satirlar()) {
    const ad = satir.dosyaAdi.trim();
    if (ad !== '') sayim.set(ad, (sayim.get(ad) ?? 0) + 1);
  }
  return new Set([...sayim].filter(([, adet]) => adet > 1).map(([ad]) => ad));
}

/** Tabloyu yeniden kurmadan yalnızca kırmızı işaretleri güncelle. */
function isaretleriTazele() {
  const tekrarlayan = tekrarlayanAdlar();
  const satirlarDom = $('tabloKabi').querySelectorAll('tr');

  satirlarDom.forEach((tr, sira) => {
    if (sira === 0) return; // başlık
    const veri = satirlar()[sira - 1];
    if (veri === undefined) return;
    const girdiler = tr.querySelectorAll('input');
    girdiler[0]?.classList.toggle('hatali', veri.metin.trim() === '');

    const cakisma = tekrarlayan.has(veri.dosyaAdi.trim());
    girdiler[1]?.classList.toggle('hatali', veri.dosyaAdi.trim() === '' || cakisma);
    // İpucu de burada güncellenmeli: yalnızca kurulumda yazılırsa kullanıcı
    // adı düzelttikten sonra "başka satırda da var" ipucu hücrede asılı kalır.
    if (girdiler[1] !== undefined) {
      girdiler[1].title = cakisma ? 'Bu dosya adı başka satırda da var' : '';
    }
  });
  $('satirSayisi').textContent = `(${satirlar().length})`;
}

/** Doğrulama sonucunu uyarı satırına yazar, sonra editöre haber verir. */
async function bildir() {
  const uyari = $('satirUyari');

  if (csvModu) {
    const sonuc = await csvdenTazele();
    // Daha yeni bir ayrıştırma başlamış: uyarıyı da kaydetmeyi de ona bırak.
    if (sonuc.durum === 'eski') return;
    const hata = sonuc.durum === 'hata' ? sonuc.mesaj : null;
    uyari.hidden = hata === null;
    uyari.textContent = hata === null ? '' : `CSV geçersiz — ${hata}`;
  } else {
    // Tablo modunda boş/tekrarlayan hücreler kırmızı görünür; sunucu 400 döner
    // ve gösterge "Geçersiz — kaydedilmedi" der.
    const bozuk = satirlar().some((s) => s.metin.trim() === '' || s.dosyaAdi.trim() === '') ||
      tekrarlayanAdlar().size > 0;
    uyari.hidden = !bozuk;
    uyari.textContent = bozuk ? 'Boş veya tekrar eden satır var — kaydedilmiyor' : '';
  }

  await degisiklikBildir();
}

export function listeyiBagla() {
  $('btnSatirEkle').addEventListener('click', () => {
    satirlariYaz([...satirlar(), { metin: '', dosyaAdi: '' }], true);
    tabloyuCiz();
    modKabuguCiz();
    // `bildir()` şart: boş satır projeyi geçersiz yapıyor. Çağrılmazsa hiç
    // kayıt planlanmaz ve gösterge önceki "Kaydedildi" damgasında kalır —
    // ekranda kaydedilmemiş bir satır varken kullanıcı kaydedilmiş sanır.
    void bildir();
  });

  $('btnCsvModu').addEventListener('click', async () => {
    if (!csvModu) {
      $('csvAlani').value = csveCevir(satirlar());
      csvModu = true;
    } else {
      const sonuc = await csvdenTazele();
      if (sonuc.durum === 'eski') return;
      if (sonuc.durum === 'hata') {
        // CSV geçersizken tabloya dönmek veriyi kaybettirir
        $('satirUyari').hidden = false;
        $('satirUyari').textContent =
          `CSV geçersiz — tabloya dönmeden önce düzeltin (${sonuc.mesaj})`;
        return;
      }
      csvModu = false;
      tabloyuCiz();
    }
    modKabuguCiz();
    void bildir();
  });

  $('csvAlani').addEventListener('input', () => void bildir());
}
