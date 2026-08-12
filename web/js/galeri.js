import { api, gorselUrl } from './api.js';
import { durum, guncelle } from './durum.js';

const $ = (id) => document.getElementById(id);

export async function galeriyiYukle(projeId) {
  if (projeId === null) {
    guncelle({ galeri: { dosyalar: [], toplamBayt: 0 } });
    return;
  }
  try {
    guncelle({ galeri: await api.galeri(projeId) });
  } catch (hata) {
    // Galeri süs; başarısızlığı ekranın kalanını durdurmaz. Yine de loglanıyor
    // ki "görseller kayboldu" sanılmasın.
    console.warn('galeri yüklenemedi:', hata);
    guncelle({ galeri: { dosyalar: [], toplamBayt: 0 } });
  }
}

export function galeriyiCiz() {
  const kap = $('galeri');
  const proje = durum.aktifProje;
  if (proje === null) {
    kap.textContent = '';
    kap.dataset.imza = '';
    return;
  }

  // Aynı dosya listesi tekrar çizilmesin — <img> yeniden yüklenmesi titrer
  const imza = `${proje.id}:${durum.galeri.dosyalar.join(',')}`;
  if (kap.dataset.imza === imza) return;
  kap.dataset.imza = imza;

  kap.textContent = '';
  for (const dosyaAdi of durum.galeri.dosyalar) {
    const gorsel = document.createElement('img');
    gorsel.src = gorselUrl(proje.id, dosyaAdi);
    gorsel.alt = dosyaAdi;
    gorsel.title = dosyaAdi;
    gorsel.loading = 'lazy';
    kap.append(gorsel);
  }
  if (durum.galeri.dosyalar.length === 0) {
    const bos = document.createElement('p');
    bos.className = 'soluk';
    bos.textContent = 'Henüz görsel yok.';
    kap.append(bos);
  }
}
