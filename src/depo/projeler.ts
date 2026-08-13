import {
  existsSync, readFileSync, readdirSync, renameSync, rmSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { dosyaAdiTemizle } from '../liste.js';
import type { Config, Satir } from '../tipler.js';
import { atomikYaz } from './atomik.js';
import { klasorGorselleriniSil } from './gorselSil.js';
import { idGecerliMi, idUret, slugla } from './kimlik.js';
import {
  ayniKlasorMu, eskiProjeYolu, projeDosyaYolu, projelerKlasoru,
} from './yollar.js';

export interface Ayarlar {
  modelAdi: string;
  satirArasiBekleme: [number, number];
  uretimZamanAsimiSn: number;
  tekrarDenemeSayisi: number;
  rateLimitVarsayilanBeklemeDk: number;
  /** Eş zamanlı sekme sayısı, 1-4. 1 = bugünkü sıralı davranış. */
  esZamanliSekme: number;
}

export interface Proje {
  id: string;
  ad: string;
  basePrompt: string;
  ciktiKlasoru: string;
  satirlar: Satir[];
  ayarlar: Ayarlar;
  olusturmaTarihi: string;
  guncellemeTarihi: string;
}

/** Sol panel için: tam kayıt taşımadan liste çizebilmek. */
export interface ProjeOzeti {
  id: string;
  ad: string;
  ciktiKlasoru: string;
  satirSayisi: number;
  guncellemeTarihi: string;
}

export interface ProjeListesi {
  projeler: ProjeOzeti[];
  /** Okunamayıp .bozuk yapılan dosya sayısı — UI uyarı satırı için. */
  bozukSayisi: number;
}

export interface SilmeSonucu {
  bulundu: boolean;
  silinen: number;
  silinemeyen: string[];
  korumaliKlasor: boolean;
}

export const VARSAYILAN_AYARLAR: Ayarlar = {
  modelAdi: '',
  satirArasiBekleme: [5, 15],
  uretimZamanAsimiSn: 180,
  tekrarDenemeSayisi: 3,
  rateLimitVarsayilanBeklemeDk: 15,
  esZamanliSekme: 1,
};

export function yeniProje(id: string, ad: string, ciktiKoku: string): Proje {
  return {
    id,
    ad,
    basePrompt: 'Bir kedi, {VARYASYON}, yüksek detaylı',
    ciktiKlasoru: join(ciktiKoku, slugla(ad)),
    satirlar: [],
    ayarlar: { ...VARSAYILAN_AYARLAR },
    olusturmaTarihi: '',
    guncellemeTarihi: '',
  };
}

export function projeDogrula(ham: unknown, ciktiKoku: string): Proje {
  const kaynak = (typeof ham === 'object' && ham !== null ? ham : {}) as Record<string, unknown>;

  const id = typeof kaynak.id === 'string' ? kaynak.id : '';
  if (!idGecerliMi(id)) {
    throw new Error('id geçersiz (yalnızca küçük harf, rakam ve tire)');
  }

  const ad = metinAlan(kaynak.ad, 'Yeni proje');
  const varsayilan = yeniProje(id, ad, ciktiKoku);

  const ciktiKlasoru = metinAlan(kaynak.ciktiKlasoru, varsayilan.ciktiKlasoru).trim();
  if (ciktiKlasoru === '') throw new Error('ciktiKlasoru boş olamaz');

  return {
    id,
    ad,
    basePrompt: metinAlan(kaynak.basePrompt, varsayilan.basePrompt),
    ciktiKlasoru,
    satirlar: satirlariDogrula(kaynak.satirlar),
    ayarlar: ayarlariDogrula(kaynak.ayarlar),
    olusturmaTarihi: metinAlan(kaynak.olusturmaTarihi, ''),
    guncellemeTarihi: metinAlan(kaynak.guncellemeTarihi, ''),
  };
}

export function projedenConfig(proje: Proje, chromeProfil: string): Config {
  return {
    basePrompt: proje.basePrompt,
    ciktiKlasoru: proje.ciktiKlasoru,
    chromeProfil,
    modelAdi: proje.ayarlar.modelAdi,
    satirArasiBekleme: proje.ayarlar.satirArasiBekleme,
    uretimZamanAsimiSn: proje.ayarlar.uretimZamanAsimiSn,
    tekrarDenemeSayisi: proje.ayarlar.tekrarDenemeSayisi,
    rateLimitVarsayilanBeklemeDk: proje.ayarlar.rateLimitVarsayilanBeklemeDk,
    esZamanliSekme: proje.ayarlar.esZamanliSekme,
  };
}

function metinAlan(deger: unknown, varsayilan: string): string {
  return typeof deger === 'string' ? deger : varsayilan;
}

function satirlariDogrula(ham: unknown): Satir[] {
  if (!Array.isArray(ham)) return [];
  const satirlar: Satir[] = [];
  const gorulen = new Set<string>();

  for (const [sira, kayit] of ham.entries()) {
    const k = (typeof kayit === 'object' && kayit !== null ? kayit : {}) as Record<string, unknown>;
    const metin = typeof k.metin === 'string' ? k.metin.trim() : '';
    const dosyaAdi = dosyaAdiTemizle(typeof k.dosyaAdi === 'string' ? k.dosyaAdi : '');

    if (metin === '' || dosyaAdi === '') {
      throw new Error(`${sira + 1}. satır: "metin" ve "dosya_adi" boş olamaz`);
    }
    if (gorulen.has(dosyaAdi)) {
      throw new Error(`${sira + 1}. satır: "${dosyaAdi}" dosya adı tekrar ediyor`);
    }
    gorulen.add(dosyaAdi);
    satirlar.push({ metin, dosyaAdi });
  }
  return satirlar;
}

/**
 * `Ayarlar`ın 6 alanını tek tek okur, `kaynak`'ı spread ETMEZ. Aksi halde
 * HTTP gövdesinden gelen bilinmeyen alanlar diske birikirdi.
 */
function ayarlariDogrula(ham: unknown): Ayarlar {
  const kaynak = (typeof ham === 'object' && ham !== null ? ham : {}) as Record<string, unknown>;

  const modelAdiHam = kaynak.modelAdi;
  if (modelAdiHam !== undefined && typeof modelAdiHam !== 'string') {
    throw new Error('modelAdi metin olmalı');
  }

  return {
    modelAdi: typeof modelAdiHam === 'string' ? modelAdiHam : VARSAYILAN_AYARLAR.modelAdi,
    satirArasiBekleme: satirArasiBeklemeDogrula(kaynak.satirArasiBekleme),
    uretimZamanAsimiSn: pozitifSayiDogrula(kaynak.uretimZamanAsimiSn, 'uretimZamanAsimiSn'),
    tekrarDenemeSayisi: pozitifSayiDogrula(kaynak.tekrarDenemeSayisi, 'tekrarDenemeSayisi'),
    rateLimitVarsayilanBeklemeDk: pozitifSayiDogrula(
      kaynak.rateLimitVarsayilanBeklemeDk,
      'rateLimitVarsayilanBeklemeDk',
    ),
    esZamanliSekme: sekmeSayisiDogrula(kaynak.esZamanliSekme),
  };
}

/**
 * Üst sınır 4: ChatGPT görsel kotası hesap başına olduğu için daha fazla sekme
 * hız kazandırmaz, yalnızca otomasyon imzasını büyütür.
 */
function sekmeSayisiDogrula(ham: unknown): number {
  if (ham === undefined) return VARSAYILAN_AYARLAR.esZamanliSekme;

  if (typeof ham !== 'number' || !Number.isInteger(ham) || ham < 1 || ham > 4) {
    throw new Error('esZamanliSekme 1 ile 4 arasında tam sayı olmalı');
  }
  return ham;
}

function satirArasiBeklemeDogrula(ham: unknown): [number, number] {
  if (ham === undefined) return VARSAYILAN_AYARLAR.satirArasiBekleme;

  if (
    !Array.isArray(ham) ||
    ham.length !== 2 ||
    ham.some((sn) => typeof sn !== 'number' || !Number.isFinite(sn) || sn < 0) ||
    ham[0] > ham[1]
  ) {
    throw new Error('satirArasiBekleme [min, maks] saniye olmalı (min <= maks)');
  }
  return [ham[0], ham[1]];
}

function pozitifSayiDogrula(
  ham: unknown,
  alan: 'uretimZamanAsimiSn' | 'tekrarDenemeSayisi' | 'rateLimitVarsayilanBeklemeDk',
): number {
  if (ham === undefined) return VARSAYILAN_AYARLAR[alan];

  if (typeof ham !== 'number' || !Number.isFinite(ham) || ham <= 0) {
    throw new Error(`${alan} pozitif bir sayı olmalı`);
  }
  return ham;
}

/** `${yol}.<son>` zaten varsa üzerine yazmaz; ilk boş `-N` adını bulur. */
function benzersizYedekYolu(yol: string, son: string): string {
  const taban = `${yol}.${son}`;
  if (!existsSync(taban)) return taban;

  let sayac = 2;
  while (existsSync(`${taban}-${sayac}`)) sayac++;
  return `${taban}-${sayac}`;
}

export class ProjelerDepo {
  constructor(
    private veriKoku: string,
    private ciktiKoku: string,
  ) {}

  /**
   * Faz 2A'nın tekil `proje.json`'unu `projeler/<id>.json`'a taşır.
   * Eski dosya `.tasindi` olarak saklanır — silinmez, göç geri dönülebilir.
   * @returns göç yapıldıysa true
   */
  gocEt(): boolean {
    const eski = eskiProjeYolu(this.veriKoku);
    if (!existsSync(eski)) return false;

    let ham: unknown;
    try {
      ham = JSON.parse(readFileSync(eski, 'utf-8'));
    } catch (hata) {
      const bozuk = benzersizYedekYolu(eski, 'bozuk');
      console.error(`eski proje.json ayrıştırılamadı, "${bozuk}" olarak taşınıyor:`, hata);
      renameSync(eski, bozuk);
      return false;
    }

    const kaynak = (typeof ham === 'object' && ham !== null ? ham : {}) as Record<string, unknown>;
    const ad = typeof kaynak.ad === 'string' && kaynak.ad.trim() !== '' ? kaynak.ad : 'Yeni proje';

    try {
      const id = idUret(ad, (aday) => existsSync(projeDosyaYolu(this.veriKoku, aday)));
      this.yaz(projeDogrula({ ...kaynak, id }, this.ciktiKoku));
    } catch (hata) {
      const bozuk = benzersizYedekYolu(eski, 'bozuk');
      console.error(`eski proje.json doğrulanamadı, "${bozuk}" olarak taşınıyor:`, hata);
      renameSync(eski, bozuk);
      return false;
    }

    renameSync(eski, benzersizYedekYolu(eski, 'tasindi'));
    console.log('proje.json göç etti; eski dosya .tasindi olarak saklandı');
    return true;
  }

  listele(): ProjeListesi {
    const klasor = projelerKlasoru(this.veriKoku);
    if (!existsSync(klasor)) return { projeler: [], bozukSayisi: 0 };

    const projeler: ProjeOzeti[] = [];
    let bozukSayisi = 0;

    for (const dosya of readdirSync(klasor)) {
      if (!dosya.endsWith('.json')) continue;
      const id = dosya.slice(0, -'.json'.length);
      if (!idGecerliMi(id)) continue;

      const proje = this.oku(id);
      if (proje === null) {
        bozukSayisi++;
        continue;
      }
      projeler.push({
        id: proje.id,
        ad: proje.ad,
        ciktiKlasoru: proje.ciktiKlasoru,
        satirSayisi: proje.satirlar.length,
        guncellemeTarihi: proje.guncellemeTarihi,
      });
    }

    // Alfabetik: otomatik kaydetme "son güncellenen üstte" sıralamasında
    // listeyi yazarken zıplatırdı.
    projeler.sort((a, b) => a.ad.localeCompare(b.ad, 'tr'));
    return { projeler, bozukSayisi };
  }

  /** Yok, geçersiz id veya bozuk dosya → null. Bozuk dosya `.bozuk` yapılır. */
  oku(id: string): Proje | null {
    if (!idGecerliMi(id)) return null;

    const yol = projeDosyaYolu(this.veriKoku, id);
    if (!existsSync(yol)) return null;

    let ham: unknown;
    try {
      ham = JSON.parse(readFileSync(yol, 'utf-8'));
    } catch (hata) {
      return this.bozukYap(yol, 'ayrıştırılamadı', hata);
    }

    try {
      return projeDogrula(ham, this.ciktiKoku);
    } catch (hata) {
      return this.bozukYap(yol, 'doğrulanamadı', hata);
    }
  }

  olustur(ad: string): Proje {
    const temizAd = ad.trim() === '' ? 'Yeni proje' : ad.trim();
    const id = idUret(temizAd, (aday) => existsSync(projeDosyaYolu(this.veriKoku, aday)));

    const taslak = yeniProje(id, temizAd, this.ciktiKoku);
    // Slug klasörü başka projede kullanılıyorsa id'yi klasör adı yap —
    // aksi halde yaz() çakışma hatası verirdi.
    const klasor = this.klasorSahibi(taslak.ciktiKlasoru, id) === null
      ? taslak.ciktiKlasoru
      : join(this.ciktiKoku, id);

    return this.yaz({ ...taslak, ciktiKlasoru: klasor, olusturmaTarihi: new Date().toISOString() });
  }

  yaz(proje: Proje): Proje {
    const dogrulanan = projeDogrula(proje, this.ciktiKoku);

    const sahip = this.klasorSahibi(dogrulanan.ciktiKlasoru, dogrulanan.id);
    if (sahip !== null) {
      throw new Error(`"${sahip}" projesi bu çıktı klasörünü kullanıyor: ${dogrulanan.ciktiKlasoru}`);
    }

    const simdi = new Date().toISOString();
    const damgali: Proje = {
      ...dogrulanan,
      olusturmaTarihi: dogrulanan.olusturmaTarihi === '' ? simdi : dogrulanan.olusturmaTarihi,
      guncellemeTarihi: simdi,
    };
    atomikYaz(projeDosyaYolu(this.veriKoku, damgali.id), JSON.stringify(damgali, null, 2));
    return damgali;
  }

  /**
   * HTTP gövdesi gibi doğrulanmamış bir kaydı yazar. `id` çağırandan gelir
   * (rota parametresi) — gövdedeki `id` yoksayılır, böylece bir projenin
   * gövdesiyle başka bir projenin üzerine yazılamaz.
   */
  guncelle(id: string, ham: unknown): Proje {
    const kaynak = (typeof ham === 'object' && ham !== null ? ham : {}) as Record<string, unknown>;
    return this.yaz(projeDogrula({ ...kaynak, id }, this.ciktiKoku));
  }

  sil(id: string, gorselleriSil: boolean): SilmeSonucu {
    const proje = this.oku(id);
    if (proje === null) {
      return { bulundu: false, silinen: 0, silinemeyen: [], korumaliKlasor: false };
    }

    const gorsel = gorselleriSil
      ? klasorGorselleriniSil(proje.ciktiKlasoru, [homedir(), this.ciktiKoku, this.veriKoku])
      : { silinen: 0, silinemeyen: [], korumaliKlasor: false };

    rmSync(projeDosyaYolu(this.veriKoku, id), { force: true });
    return { bulundu: true, ...gorsel };
  }

  /**
   * Aynı çıktı klasörünü kullanan başka bir proje varsa adını döner.
   * Devam mantığı "PNG diskte varsa satırı atla" olduğu için klasör paylaşan
   * iki proje birbirinin satırlarını bitmiş sayardı. Karşılaştırma
   * `./yollar.js`'teki `ayniKlasorMu` ile yapılır — salt metin eşitliği,
   * harf kasasına duyarsız dosya sistemlerinde bu çakışmayı kaçırırdı.
   */
  private klasorSahibi(klasor: string, hariçId: string): string | null {
    for (const ozet of this.listele().projeler) {
      if (ozet.id === hariçId) continue;
      if (ayniKlasorMu(ozet.ciktiKlasoru, klasor)) return ozet.ad;
    }
    return null;
  }

  private bozukYap(yol: string, sebep: string, hata: unknown): null {
    const bozuk = benzersizYedekYolu(yol, 'bozuk');
    console.error(`proje dosyası ${sebep} (${yol}), "${bozuk}" olarak taşınıyor:`, hata);
    renameSync(yol, bozuk);
    return null;
  }
}
