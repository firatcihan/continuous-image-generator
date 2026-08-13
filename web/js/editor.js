import { api } from './api.js';
import { durum, guncelle, projeCalisiyorMu } from './durum.js';
import { gecersizIsaretle, kaydetmeyiPlanla } from './kaydet.js';

const $ = (id) => document.getElementById(id);

const AYAR_ALANLARI = [
  { anahtar: 'modelAdi', etiket: 'Beklenen model adı', tur: 'text',
    ipucu: 'Boş bırakılırsa model kontrolü atlanır.' },
  { anahtar: 'uretimZamanAsimiSn', etiket: 'Üretim zaman aşımı (sn)', tur: 'number' },
  { anahtar: 'tekrarDenemeSayisi', etiket: 'Tekrar deneme sayısı', tur: 'number' },
  { anahtar: 'rateLimitVarsayilanBeklemeDk', etiket: 'Limit varsayılan bekleme (dk)', tur: 'number' },
  { anahtar: 'esZamanliSekme', etiket: 'Eş zamanlı sekme', tur: 'number', maks: 4,
    ipucu: '1 = sırayla. Yükseltmek üretimi hızlandırır, ama ChatGPT kotası hesap '
      + 'başınadır — limit daha erken gelebilir.' },
];

/** Formdaki her şeyi okuyup tam bir proje nesnesi kurar. */
export function formdanProje() {
  const temel = durum.aktifProje;
  if (temel === null) return null;

  return {
    ...temel,
    basePrompt: $('basePrompt').value,
    script: $('scriptAlani').value,
    ciktiKlasoru: $('ayar-ciktiKlasoru').value.trim(),
    // Satırların tek gerçek kaynağı durum.js; liste.js yazar, burası okur
    satirlar: durum.satirGecerli ? durum.satirlar.map((s) => ({ ...s })) : null,
    ayarlar: {
      modelAdi: $('ayar-modelAdi').value,
      satirArasiBekleme: [Number($('ayar-beklemeMin').value), Number($('ayar-beklemeMaks').value)],
      uretimZamanAsimiSn: Number($('ayar-uretimZamanAsimiSn').value),
      tekrarDenemeSayisi: Number($('ayar-tekrarDenemeSayisi').value),
      rateLimitVarsayilanBeklemeDk: Number($('ayar-rateLimitVarsayilanBeklemeDk').value),
      esZamanliSekme: Number($('ayar-esZamanliSekme').value),
    },
  };
}

/** Kaydetmeden önceki istemci tarafı doğrulama. Hata metni veya null döner. */
function projeyiDogrula(proje) {
  const [min, maks] = proje.ayarlar.satirArasiBekleme;
  if (!Number.isFinite(min) || !Number.isFinite(maks) || min < 0 || min > maks) {
    return 'Bekleme aralığı geçersiz (min ≤ maks olmalı)';
  }
  for (const alan of ['uretimZamanAsimiSn', 'tekrarDenemeSayisi', 'rateLimitVarsayilanBeklemeDk']) {
    if (!Number.isFinite(proje.ayarlar[alan]) || proje.ayarlar[alan] <= 0) {
      return `${alan} pozitif bir sayı olmalı`;
    }
  }
  const sekme = proje.ayarlar.esZamanliSekme;
  if (!Number.isInteger(sekme) || sekme < 1 || sekme > 4) {
    return 'Eş zamanlı sekme 1 ile 4 arasında tam sayı olmalı';
  }
  if (proje.satirlar === null) return 'Satır listesi geçersiz';
  if (proje.ciktiKlasoru === '') return 'Çıktı klasörü boş olamaz';
  return null;
}

/** Değişiklik oldu: önizlemeyi tazele, doğrula, kaydetmeyi planla. */
export async function degisiklikBildir() {
  const proje = formdanProje();
  if (proje === null) return;

  const hata = projeyiDogrula(proje);
  if (hata !== null) {
    gecersizIsaretle(hata);
  } else {
    kaydetmeyiPlanla(proje);
  }

  await onizlemeyiTazele(proje);
  kaydetGostergesiniCiz();
}

/**
 * Önizleme isteği ağ hatası ya da beklenmeyen bir sunucu yanıtıyla
 * reddedebilir (ör. bağlantı koptu). Bu, otomatik kaydetmeyi ETKİLEMEMELİ —
 * doğrulama ve `kaydetmeyiPlanla` zaten önizlemeden bağımsız çalışıyor.
 * Yakalanmazsa `degisiklikBildir` içindeki `await` burada patlar,
 * `kaydetGostergesiniCiz()` hiç çalışmaz ve konsolda yakalanmamış bir
 * reddetme belirir (`editoruCiz`'in ateşle-unut çağrısında da aynı risk var).
 */
async function onizlemeyiTazele(proje) {
  try {
    const sonuc = await api.onizleme(proje.id, proje.basePrompt, proje.satirlar ?? []);

    $('promptUyari').hidden = sonuc.yerTutucuVar;
    $('promptUyari').textContent =
      'Prompt içinde {VARYASYON} yok — her satır aynı görseli üretirdi';
    $('basePrompt').classList.toggle('hatali', !sonuc.yerTutucuVar);

    const liste = $('onizleme');
    liste.textContent = '';
    for (const metin of sonuc.onizleme) {
      const oge = document.createElement('li');
      oge.textContent = metin;
      liste.append(oge);
    }
  } catch (hata) {
    // Önizleme salt görsel bir yardımcı; başarısızlığı kaydetmeyi engellemez,
    // yalnızca günlüğe düşer ki liste eski (belki yanlış) halde takılı kalırsa
    // sebebi görülebilsin.
    console.error('önizleme tazelenemedi:', hata);
  }
}

export function kaydetGostergesiniCiz() {
  const metinler = {
    bosta: '',
    kaydediliyor: 'Kaydediliyor…',
    kaydedildi: `Kaydedildi ${durum.kaydetZamani ?? ''}`,
    gecersiz: `Geçersiz — kaydedilmedi${durum.hata ? ` (${durum.hata})` : ''}`,
  };
  $('kaydetDurum').textContent = metinler[durum.kaydetDurumu] ?? '';
}

/** Hangi projenin formu doldurulmuş — alan değerlerini gereksiz yazmamak için. */
let cizilenProjeId = null;

/**
 * Her `guncelle()` çağrısında koşar. Alan değerleri YALNIZCA proje
 * değiştiğinde yazılır: `input.value` atamak imleci sonuna atar, kullanıcı
 * yazarken her otomatik kayıt imleci kaçırırdı.
 */
export function editoruCiz() {
  const proje = durum.aktifProje;
  if (proje === null) {
    cizilenProjeId = null;
    return;
  }

  if (cizilenProjeId !== proje.id) {
    $('basePrompt').value = proje.basePrompt;
    $('scriptAlani').value = proje.script;
    ayarlariCiz(proje);
    cizilenProjeId = proje.id;
    void onizlemeyiTazele(formdanProje());
  }

  const kilitli = projeCalisiyorMu(proje.id);
  $('kilitUyari').hidden = !kilitli;
  $('projeEkrani').classList.toggle('kilitli', kilitli);

  kaydetGostergesiniCiz();
}

function ayarlariCiz(proje) {
  const kap = $('ayarlar');
  if (kap.dataset.kuruldu === '1') {
    // Alanlar zaten var; yalnızca değerleri yaz — yazarken imleç kaybolmasın
    $('ayar-modelAdi').value = proje.ayarlar.modelAdi;
    $('ayar-ciktiKlasoru').value = proje.ciktiKlasoru;
    $('ayar-beklemeMin').value = proje.ayarlar.satirArasiBekleme[0];
    $('ayar-beklemeMaks').value = proje.ayarlar.satirArasiBekleme[1];
    for (const alan of AYAR_ALANLARI.slice(1)) {
      $(`ayar-${alan.anahtar}`).value = proje.ayarlar[alan.anahtar];
    }
    return;
  }

  kap.textContent = '';

  // Çıktı klasörü `ayarlar` içinde değil, projenin kök alanı — ama kullanıcı
  // için bir ayar. Ad değişince otomatik değişmez (spec §3): üretilmiş
  // görseller eski klasörde yalnız kalmasın.
  const klasorEtiket = document.createElement('label');
  klasorEtiket.textContent = 'Çıktı klasörü';
  klasorEtiket.title = 'İki proje aynı klasörü kullanamaz.';
  const klasorGirdi = document.createElement('input');
  klasorGirdi.type = 'text';
  klasorGirdi.id = 'ayar-ciktiKlasoru';
  klasorGirdi.value = proje.ciktiKlasoru;
  klasorEtiket.htmlFor = klasorGirdi.id;
  kap.append(klasorEtiket, klasorGirdi);

  const beklemeEtiket = document.createElement('label');
  beklemeEtiket.textContent = 'Satır arası bekleme (sn, min – maks)';
  beklemeEtiket.htmlFor = 'ayar-beklemeMin'; // iki alanlı satır: etiket min'e işaret eder
  kap.append(beklemeEtiket);
  const beklemeKap = document.createElement('div');
  beklemeKap.className = 'satir';
  for (const [id, deger] of [
    ['ayar-beklemeMin', proje.ayarlar.satirArasiBekleme[0]],
    ['ayar-beklemeMaks', proje.ayarlar.satirArasiBekleme[1]],
  ]) {
    const girdi = document.createElement('input');
    girdi.type = 'number';
    girdi.id = id;
    girdi.min = '0';
    girdi.value = String(deger);
    beklemeKap.append(girdi);
  }
  kap.append(beklemeKap);

  // Kalan alanlar yan yana: hepsi kısa değerler, tam genişlik istemiyor.
  const izgara = document.createElement('div');
  izgara.className = 'ayar-izgara';
  for (const alan of AYAR_ALANLARI) {
    const hucre = document.createElement('div');
    const etiket = document.createElement('label');
    etiket.textContent = alan.etiket;
    if (alan.ipucu) etiket.title = alan.ipucu;
    const girdi = document.createElement('input');
    girdi.type = alan.tur;
    girdi.id = `ayar-${alan.anahtar}`;
    if (alan.tur === 'number') girdi.min = '1';
    if (alan.maks !== undefined) girdi.max = String(alan.maks);
    girdi.value = String(proje.ayarlar[alan.anahtar]);
    etiket.htmlFor = girdi.id;
    hucre.append(etiket, girdi);
    izgara.append(hucre);
  }
  kap.append(izgara);

  kap.dataset.kuruldu = '1';
  kap.addEventListener('input', () => void degisiklikBildir());
}

export function editoruBagla() {
  $('basePrompt').addEventListener('input', () => void degisiklikBildir());

  $('btnYerTutucu').addEventListener('click', () => {
    const alan = $('basePrompt');
    const bas = alan.selectionStart ?? alan.value.length;
    alan.value = `${alan.value.slice(0, bas)}{VARYASYON}${alan.value.slice(bas)}`;
    alan.focus();
    void degisiklikBildir();
  });
}
