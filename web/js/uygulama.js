import { abone, durum } from './durum.js';
import { editoruBagla, editoruCiz } from './editor.js';
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
  editoruBagla();
  listeyiBagla();

  $('btnYeniProje').addEventListener('click', () => yeniProjeSatiriAc());
  window.addEventListener('hashchange', () => void yonlendir());

  await projeleriYukle();
  await yonlendir();
  projeleriCiz();
}

void baslat();
