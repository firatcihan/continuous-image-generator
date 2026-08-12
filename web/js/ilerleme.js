import { api } from './api.js';
import { durum, guncelle, isMesgulMu, projeCalisiyorMu } from './durum.js';
import { projeSec } from './projeler.js';

const $ = (id) => document.getElementById(id);

const DURUM_METINLERI = {
  bosta: 'Henüz çalıştırılmadı',
  calisiyor: 'Çalışıyor',
  duraklatildi: 'Duraklatıldı',
  limitBekliyor: 'Rate limit — bekleniyor',
  kullaniciBekliyor: 'Sizi bekliyor',
  bitti: 'Bitti',
  durduruldu: 'Durduruldu',
  hata: 'Hata',
};

/**
 * Tarayıcı açma isteği uçarken true. Buton `butonlariCiz` tarafından her
 * `guncelle()`de yeniden çiziliyor; bu bayrak olmadan araya giren herhangi bir
 * durum olayı butonu "1 · Tarayıcıyı aç" ve etkin hâline geri döndürüyor,
 * kullanıcı ikinci kez tıklayabiliyordu. Sunucu ikinci açmayı ancak ilki
 * BİTTİKTEN sonra eliyor (`tarayiciAcikMi()`), yani açılış sürerken gelen
 * ikinci istek ikinci bir Chromium başlatırdı.
 */
let tarayiciAciliyor = false;

/**
 * Durdur'a basıldı ama iş henüz durmadı.
 *
 * `durdur()` yalnızca AbortController'ı tetikliyor; worker bunu ancak SIRADAKİ
 * KONTROL NOKTASINDA görüyor ve o an bir Playwright beklemesinin içinde
 * olabiliyor (canlı ölçümde ~30 sn'lik bir `waitForSelector`; üretimde
 * `uretimZamanAsimiSn` kadar). Bu arada durum hâlâ 'calisiyor' geldiği için
 * ekranda HİÇBİR ŞEY değişmiyordu — kullanıcı butonun çalışmadığını sanıyor ve
 * tekrar tıklıyor. Bayrak, iş gerçekten durana kadar bunu söylüyor.
 */
let durdurmaBekliyor = false;

export function kayitEkle(metin) {
  const satir = document.createElement('div');
  satir.textContent = `${new Date().toLocaleTimeString('tr-TR')} ${metin}`;
  $('kayit').prepend(satir);
  while ($('kayit').childElementCount > 200) $('kayit').lastElementChild.remove();
}

/**
 * İş durumunu HTTP ile bir kez okur. SSE'nin açılışta yolladığı `durum` olayı
 * `sira`/`toplam` TAŞIMIYOR (yalnızca durum/projeId/ozet); onlar akışta ancak
 * bir sonraki `satirBasladi` ile geliyor. Sayfayı iş ortasında yenileyen
 * kullanıcı bu çağrı olmadan 7/20 yerine 0/20 görürdü. `GET /api/is` tam
 * `bilgi()`yi döndürüyor, sira/toplam dahil.
 */
export async function isDurumunuTazele() {
  try {
    const bilgi = await api.is();
    guncelle({
      is: {
        ...durum.is,
        durum: bilgi.durum,
        projeId: bilgi.projeId,
        ozet: bilgi.ozet,
        sira: bilgi.sira,
        toplam: bilgi.toplam,
      },
    });
  } catch (hata) {
    console.warn('iş durumu okunamadı:', hata);
  }
}

export function ilerlemeyiCiz() {
  const proje = durum.aktifProje;
  const is = durum.is;
  // İş gerçekten durdu (ya da başka bir sebeple bitti): bekleme bitti
  if (durdurmaBekliyor && !isMesgulMu()) durdurmaBekliyor = false;
  const calisiyor = proje !== null && projeCalisiyorMu(proje.id);
  // İş BİTMİŞ olsa da (bitti/durduruldu/hata) sayılar bu projeye ait: son
  // özeti yalnızca kayıt akışında bırakmak kullanıcıyı geçmişi kaydırmaya
  // zorlar.
  const buProjeninIsi = proje !== null && is.projeId === proje.id;

  const kap = $('ilerleme');
  kap.textContent = '';

  // SSE koptuysa ekrandaki sayılar donmuş olabilir; bunu saklamak yanıltıcı olur
  if (!durum.akisBagli) {
    const kopuk = document.createElement('p');
    kopuk.className = 'uyari-metin';
    kopuk.textContent = 'Canlı bağlantı yok — yeniden bağlanılıyor…';
    kap.append(kopuk);
  }

  const baslik = document.createElement('p');
  baslik.textContent = buProjeninIsi
    ? DURUM_METINLERI[is.durum] ?? is.durum
    : DURUM_METINLERI.bosta;
  kap.append(baslik);

  if (buProjeninIsi) {
    const sayac = document.createElement('p');
    sayac.className = 'soluk';
    sayac.textContent =
      `${is.sira}/${is.toplam} · ✓ ${is.ozet.basarili} · atlanan ${is.ozet.atlanan} · ✗ ${is.ozet.basarisiz}`;
    kap.append(sayac);

    if (durdurmaBekliyor) {
      const bekleme = document.createElement('p');
      bekleme.className = 'uyari-metin';
      bekleme.textContent =
        'Durduruluyor — sıradaki kontrol noktasında bitecek (görsel beklemesi sürebilir).';
      kap.append(bekleme);
    }

    if (calisiyor && is.durum === 'limitBekliyor' && is.kalanSn !== null) {
      const geri = document.createElement('p');
      geri.className = 'uyari-metin';
      geri.textContent = `Limit bekleniyor — kalan ${is.kalanSn} sn`;
      kap.append(geri);
    }
  }

  const kullaniciGerekli = calisiyor && is.durum === 'kullaniciBekliyor';
  $('kullaniciKarti').hidden = !kullaniciGerekli;
  $('kullaniciMesaj').textContent = is.mesaj ?? '';

  butonlariCiz();
  seridiCiz();
}

function butonlariCiz() {
  const proje = durum.aktifProje;
  const buProje = proje !== null && projeCalisiyorMu(proje.id);
  const baskaIsVar = isMesgulMu() && !buProje;

  if (tarayiciAciliyor) {
    $('btnTarayici').textContent = 'Açılıyor…';
    $('btnTarayici').disabled = true;
  } else {
    $('btnTarayici').textContent = durum.tarayiciAcik ? '✓ Tarayıcı açık' : '1 · Tarayıcıyı aç';
    $('btnTarayici').disabled = durum.tarayiciAcik;
  }

  $('btnBaslat').disabled = proje === null || isMesgulMu() || !durum.tarayiciAcik;
  $('btnBaslat').title = baskaIsVar
    ? 'Bir iş zaten çalışıyor'
    : (!durum.tarayiciAcik ? 'Önce tarayıcıyı açıp ChatGPT\'ye giriş yapın' : '');

  $('btnDuraklat').disabled = !buProje || durum.is.durum === 'duraklatildi';
  $('btnDevam').disabled = !buProje || durum.is.durum !== 'duraklatildi';
  $('btnDurdur').disabled = !buProje || durdurmaBekliyor;
}

function seridiCiz() {
  const serit = $('isSeridi');
  if (!isMesgulMu() || durum.is.projeId === null) {
    serit.hidden = true;
    return;
  }

  const ozet = durum.projeler.find((p) => p.id === durum.is.projeId);
  serit.hidden = false;
  serit.textContent = '';

  const metin = document.createElement('span');
  metin.textContent =
    `▶ ${ozet ? ozet.ad : durum.is.projeId} — ${durum.is.sira}/${durum.is.toplam}`;
  serit.append(metin);

  // Kullanıcı başka projeye gezmişken şerit kaybolmaz; tek iş kısıtının
  // görünür karşılığı.
  if (durum.aktifProje === null || durum.aktifProje.id !== durum.is.projeId) {
    const git = document.createElement('button');
    git.className = 'git';
    git.textContent = 'Projeye git';
    git.addEventListener('click', () => void projeSec(durum.is.projeId));
    serit.append(git);
  }
}

async function tarayiciDurumunuTazele() {
  try {
    guncelle({ tarayiciAcik: (await api.tarayici()).acik });
  } catch (hata) {
    console.warn('tarayıcı durumu okunamadı:', hata);
    guncelle({ tarayiciAcik: false });
  }
}

export function ilerlemeyiBagla() {
  $('btnTarayici').addEventListener('click', async () => {
    if (tarayiciAciliyor || durum.tarayiciAcik) return;
    tarayiciAciliyor = true;
    butonlariCiz();
    try {
      await api.tarayiciAc();
      kayitEkle('tarayıcı açıldı — ChatGPT\'ye giriş yapın');
    } catch (hata) {
      kayitEkle(`tarayıcı açılamadı: ${hata.message}`);
    } finally {
      tarayiciAciliyor = false;
    }
    await tarayiciDurumunuTazele();
  });

  $('btnBaslat').addEventListener('click', async () => {
    if (durum.aktifProje === null) return;
    try {
      await api.isBaslat(durum.aktifProje.id);
    } catch (hata) {
      kayitEkle(`başlatılamadı: ${hata.message}`);
    }
  });

  $('btnDurdur').addEventListener('click', async () => {
    durdurmaBekliyor = true;
    ilerlemeyiCiz(); // "Durduruluyor…" hemen görünsün, sunucu yanıtı beklenmeden
    try {
      await api.isDurdur();
    } catch (hata) {
      durdurmaBekliyor = false;
      kayitEkle(hata.message);
      ilerlemeyiCiz();
    }
  });

  const eylemler = [
    ['btnDuraklat', api.isDuraklat],
    ['btnDevam', api.isDevam],
    ['btnHazir', api.kullaniciHazir],
  ];
  for (const [id, eylem] of eylemler) {
    $(id).addEventListener('click', async () => {
      try {
        await eylem();
      } catch (hata) {
        kayitEkle(hata.message);
      }
    });
  }

  void tarayiciDurumunuTazele();
}
