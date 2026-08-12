import { akisiBaslat } from './akis.js';
import { api } from './api.js';
import { abone, durum } from './durum.js';
import { editoruBagla, editoruCiz } from './editor.js';
import { galeriyiCiz } from './galeri.js';
import { ilerlemeyiBagla, ilerlemeyiCiz, isDurumunuTazele, kayitEkle } from './ilerleme.js';
import { listeyiBagla, listeyiCiz } from './liste.js';
import { projeSec, projeleriCiz, projeleriYukle, yeniProjeSatiriAc } from './projeler.js';

const $ = (id) => document.getElementById(id);

function hashtenId() {
  const eslesme = location.hash.match(/^#\/proje\/([a-z0-9-]+)$/);
  return eslesme ? eslesme[1] : null;
}

async function yonlendir() {
  const id = hashtenId();
  if (id !== null) {
    if (!durum.aktifProje || durum.aktifProje.id !== id) await projeSec(id);
    return;
  }
  // Hash yoksa: alfabetik ilk proje. Hiç proje yoksa boş durum.
  const ilk = durum.projeler[0];
  await projeSec(ilk ? ilk.id : null);
}

async function baslat() {
  abone(projeleriCiz);
  // Satır tablosu editörden önce çizilir: ikisi de `durum`dan okuyor, ama
  // proje değişiminde tablonun kurulu olması önizleme listesinin yanındaki
  // satır sayacıyla aynı turda tutarlı görünmesini sağlıyor.
  abone(listeyiCiz);
  abone(editoruCiz);
  abone(galeriyiCiz);
  abone(ilerlemeyiCiz);

  editoruBagla();
  listeyiBagla();
  ilerlemeyiBagla();

  $('btnYeniProje').addEventListener('click', () => yeniProjeSatiriAc());
  $('btnKlasor').addEventListener('click', async () => {
    if (durum.aktifProje === null) return;
    try {
      await api.klasoruAc(durum.aktifProje.id);
    } catch (hata) {
      kayitEkle(`klasör açılamadı: ${hata.message}`);
    }
  });
  window.addEventListener('hashchange', () => void yonlendir());

  await projeleriYukle();
  await yonlendir();
  // SSE'nin açılış olayı sira/toplam taşımıyor; iş ortasında yenilenen sayfa
  // için sayıları HTTP'den bir kez tohumla (bkz. ilerleme.js).
  await isDurumunuTazele();
  akisiBaslat();

  projeleriCiz();
  ilerlemeyiCiz();
}

void baslat();
