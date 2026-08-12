import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { dosyaAdiTemizle } from '../liste.js';
import type { Config, Satir } from '../tipler.js';
import { atomikYaz } from './atomik.js';
import { eskiProjeYolu } from './yollar.js';

export interface Ayarlar {
  modelAdi: string;
  satirArasiBekleme: [number, number];
  uretimZamanAsimiSn: number;
  tekrarDenemeSayisi: number;
  rateLimitVarsayilanBeklemeDk: number;
}

export interface Proje {
  ad: string;
  basePrompt: string;
  ciktiKlasoru: string;
  satirlar: Satir[];
  ayarlar: Ayarlar;
  guncellemeTarihi: string;
}

export const VARSAYILAN_AYARLAR: Ayarlar = {
  modelAdi: '',
  satirArasiBekleme: [5, 15],
  uretimZamanAsimiSn: 180,
  tekrarDenemeSayisi: 3,
  rateLimitVarsayilanBeklemeDk: 15,
};

export function varsayilanProje(ciktiKoku: string): Proje {
  return {
    ad: 'Yeni proje',
    basePrompt: 'Bir kedi, {VARYASYON}, yüksek detaylı',
    ciktiKlasoru: join(ciktiKoku, 'yeni-proje'),
    satirlar: [],
    ayarlar: { ...VARSAYILAN_AYARLAR },
    guncellemeTarihi: '',
  };
}

export function projeDogrula(ham: unknown, ciktiKoku: string): Proje {
  const kaynak = (typeof ham === 'object' && ham !== null ? ham : {}) as Record<string, unknown>;
  const varsayilan = varsayilanProje(ciktiKoku);

  const ad = metinAlan(kaynak.ad, varsayilan.ad);
  const basePrompt = metinAlan(kaynak.basePrompt, varsayilan.basePrompt);

  const ciktiKlasoru = metinAlan(kaynak.ciktiKlasoru, varsayilan.ciktiKlasoru);
  if (ciktiKlasoru.trim() === '') throw new Error('ciktiKlasoru boş olamaz');

  return {
    ad,
    basePrompt,
    ciktiKlasoru: ciktiKlasoru.trim(),
    satirlar: satirlariDogrula(kaynak.satirlar),
    ayarlar: ayarlariDogrula(kaynak.ayarlar),
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
  };
}

export class ProjeDepo {
  constructor(private veriKoku: string) {}

  oku(ciktiKoku: string): Proje {
    const yol = eskiProjeYolu(this.veriKoku);
    if (!existsSync(yol)) return varsayilanProje(ciktiKoku);

    let ham: unknown;
    try {
      ham = JSON.parse(readFileSync(yol, 'utf-8'));
    } catch (hata) {
      const bozukYol = benzersizBozukYolu(yol);
      console.error(`proje.json ayrıştırılamadı (${yol}), "${bozukYol}" olarak taşınıyor:`, hata);
      renameSync(yol, bozukYol);
      return varsayilanProje(ciktiKoku);
    }

    try {
      return projeDogrula(ham, ciktiKoku);
    } catch (hata) {
      const bozukYol = benzersizBozukYolu(yol);
      console.error(`proje.json doğrulanamadı (${yol}), "${bozukYol}" olarak taşınıyor:`, hata);
      renameSync(yol, bozukYol);
      return varsayilanProje(ciktiKoku);
    }
  }

  yaz(proje: Proje): void {
    const damgali: Proje = { ...proje, guncellemeTarihi: new Date().toISOString() };
    atomikYaz(eskiProjeYolu(this.veriKoku), JSON.stringify(damgali, null, 2));
  }
}

function metinAlan(deger: unknown, varsayilan: string): string {
  return typeof deger === 'string' ? deger : varsayilan;
}

/**
 * `${yol}.bozuk` zaten varsa üzerine yazmaz; ilk boş `.bozuk-N` adını bulur.
 * `rename` hedefi sessizce ezdiği için art arda bozulma olaylarında önceki
 * yedeğin kaybolmaması için gerekli.
 */
function benzersizBozukYolu(yol: string): string {
  const taban = `${yol}.bozuk`;
  if (!existsSync(taban)) return taban;

  let sayac = 2;
  while (existsSync(`${taban}-${sayac}`)) sayac++;
  return `${taban}-${sayac}`;
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
 * `Ayarlar` arayüzündeki 5 alanı tek tek okur ve doğrular — `kaynak`'ı
 * spread ETMEZ. Aksi halde bilinmeyen alanlar (veya `kaynak` bir dizi olduğunda
 * sayısal indeks anahtarları) sonuca sızar ve her `yaz()` çağrısında diske
 * yazılıp birikir.
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
  };
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
