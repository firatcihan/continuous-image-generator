import { durum, guncelle } from './durum.js';
import { galeriyiYukle } from './galeri.js';
import { kayitEkle } from './ilerleme.js';
import { projeleriYukle } from './projeler.js';

/**
 * SSE, `EventSource` ile açılır ve başlık eklenemez — token bu yüzden
 * çerezle taşınıyor (aynı origin olduğu için çerez otomatik gider).
 */
export function akisiBaslat() {
  const kaynak = new EventSource('/api/is/akis');

  kaynak.addEventListener('open', () => guncelle({ akisBagli: true }));

  kaynak.addEventListener('error', () => {
    // EventSource kendisi yeniden bağlanır; sadece göstergeyi düşür
    guncelle({ akisBagli: false });
  });

  kaynak.addEventListener('message', (olay) => {
    let veri;
    try {
      veri = JSON.parse(olay.data);
    } catch {
      return;
    }
    void olayIsle(veri);
  });
}

async function olayIsle(olay) {
  const is = { ...durum.is };

  switch (olay.tip) {
    case 'durum':
      is.durum = olay.durum;
      is.projeId = olay.projeId;
      is.ozet = olay.ozet;
      if (olay.durum !== 'limitBekliyor') is.kalanSn = null;
      if (olay.durum !== 'kullaniciBekliyor') is.mesaj = null;
      guncelle({ is, akisBagli: true });
      return;

    case 'satirBasladi':
      is.sira = olay.sira;
      is.toplam = olay.toplam;
      guncelle({ is });
      kayitEkle(`${olay.sira}/${olay.toplam} ${olay.dosyaAdi} başladı`);
      return;

    case 'gorselHazir':
      kayitEkle(`${olay.dosyaAdi} hazır`);
      // Galeri yalnızca ekranda o proje açıksa tazelenir
      if (durum.aktifProje !== null && durum.aktifProje.id === durum.is.projeId) {
        await galeriyiYukle(durum.aktifProje.id);
      }
      return;

    case 'satirBitti':
      kayitEkle(`${olay.sira}. satır: ${olay.sonuc}${olay.sebep ? ` (${olay.sebep})` : ''}`);
      return;

    case 'limitBekleniyor':
      is.kalanSn = olay.kalanSn;
      guncelle({ is });
      return;

    // Worker geçici bir hatada satırı yeniden deniyor. Kayda yazılmazsa
    // kullanıcı ekranın takıldığını sanıyor.
    case 'geciciHata':
      kayitEkle('geçici hata — yeniden denenecek');
      return;

    case 'kullaniciGerekli':
      is.mesaj = olay.mesaj;
      guncelle({ is });
      kayitEkle(`sizi bekliyor: ${olay.mesaj}`);
      return;

    case 'hata':
      kayitEkle(`hata: ${olay.mesaj}`);
      guncelle({ hata: olay.mesaj });
      return;

    case 'bitti':
      is.ozet = olay.ozet;
      guncelle({ is });
      kayitEkle(
        `bitti — ✓ ${olay.ozet.basarili}, atlanan ${olay.ozet.atlanan}, ✗ ${olay.ozet.basarisiz}`,
      );
      await projeleriYukle();
      if (durum.aktifProje !== null) await galeriyiYukle(durum.aktifProje.id);
      return;

    default:
      return;
  }
}
