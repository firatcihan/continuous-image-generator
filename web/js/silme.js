import { api } from './api.js';
import { durum } from './durum.js';
import { kayitEkle } from './ilerleme.js';
import { projeSec, projeleriYukle } from './projeler.js';

const $ = (id) => document.getElementById(id);

let hedef = null;

function boyutMetni(bayt) {
  if (bayt < 1024) return `${bayt} B`;
  if (bayt < 1024 * 1024) return `${(bayt / 1024).toFixed(1)} KB`;
  return `${(bayt / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Diyalog SENKRON açılıyor, görsel sayısı sonra dolduruluyor. Sayımı
 * bekleyip sonra açmak iki sorun üretiyordu: (1) yavaş diskte kullanıcı
 * `×`'e bastıktan sonra bir süre hiçbir şey görmüyor, (2) hızlı iki tıklama
 * iki `diyaloguAc` başlatıyor ve ikinci `showModal()` zaten açık diyalogda
 * `InvalidStateError` fırlatıyordu — `void diyaloguAc(...)` çağrısı olduğu
 * için bu yakalanmamış bir reddetme olarak konsola düşüyordu.
 */
async function diyaloguAc(ozet) {
  const diyalog = $('silDiyalogu');
  if (diyalog.open) return;

  hedef = ozet;
  $('silBaslik').textContent = `"${ozet.ad}" projesini sil?`;
  $('silKlasor').textContent = ozet.ciktiKlasoru;
  $('silSayi').textContent = 'Görseller sayılıyor…';
  $('silGorseller').checked = true;
  diyalog.showModal();

  // Sayı ve boyut sunucudan gelir, istemci tahmini değil
  let galeri = { dosyalar: [], toplamBayt: 0 };
  try {
    galeri = await api.galeri(ozet.id);
  } catch (hata) {
    // Klasör okunamadıysa 0 göster; silme yine denenir
    console.warn('görsel sayısı okunamadı:', hata);
  }
  // Kullanıcı sayım dönmeden diyalogu kapatıp başkasını açmış olabilir
  if (hedef === null || hedef.id !== ozet.id) return;
  $('silSayi').textContent =
    `${galeri.dosyalar.length} görsel (${boyutMetni(galeri.toplamBayt)})`;
}

async function onayla() {
  if (hedef === null) return;
  const gorselleriSil = $('silGorseller').checked;
  const silinen = hedef;
  hedef = null;
  $('silDiyalogu').close();

  try {
    const sonuc = await api.projeSil(silinen.id, gorselleriSil);

    if (sonuc.korumaliKlasor) {
      kayitEkle(
        `"${silinen.ad}" kaydı silindi. Çıktı klasörü tek bir projeye ait görünmediği için ` +
        `görseller silinmedi — elle silin: ${silinen.ciktiKlasoru}`,
      );
    } else if (sonuc.silinemeyen.length > 0) {
      kayitEkle(
        `"${silinen.ad}" silindi. ${sonuc.silinen} görsel silindi, ` +
        `${sonuc.silinemeyen.length} dosya silinemedi: ${sonuc.silinemeyen.join(', ')}`,
      );
    } else {
      kayitEkle(`"${silinen.ad}" silindi (${sonuc.silinen} görsel).`);
    }
  } catch (hata) {
    kayitEkle(`silinemedi: ${hata.message}`);
    return;
  }

  await projeleriYukle();
  // Silinen proje açıksa: ilk projeye düş, hiç proje kalmadıysa boş duruma
  if (durum.aktifProje !== null && durum.aktifProje.id === silinen.id) {
    location.hash = '';
    const ilk = durum.projeler[0];
    await projeSec(ilk ? ilk.id : null);
  }
}

export function silmeyiBagla() {
  document.addEventListener('proje-sil-istegi', (olay) => void diyaloguAc(olay.detail));
  $('silOnayla').addEventListener('click', () => void onayla());
  $('silVazgec').addEventListener('click', () => $('silDiyalogu').close());
  // Escape ile kapanış hiçbir butona basmıyor; hedefi tek yerden temizle ki
  // diyalog kapalıyken elde bayat bir hedef kalmasın.
  $('silDiyalogu').addEventListener('close', () => { hedef = null; });
}
