import { readFileSync } from 'node:fs';
import type { Satir } from './tipler.js';

/** Tırnaklı alan ve CRLF destekli mini CSV ayrıştırıcı. */
export function csvAyristir(icerik: string): string[][] {
  const satirlar: string[][] = [];
  let alanlar: string[] = [];
  let alan = '';
  let tirnakIcinde = false;

  const satiriBitir = () => {
    alanlar.push(alan);
    alan = '';
    if (alanlar.some((a) => a.trim() !== '')) satirlar.push(alanlar);
    alanlar = [];
  };

  for (let i = 0; i < icerik.length; i++) {
    const karakter = icerik[i];
    if (tirnakIcinde) {
      if (karakter === '"') {
        if (icerik[i + 1] === '"') {
          alan += '"';
          i++;
        } else {
          tirnakIcinde = false;
        }
      } else {
        alan += karakter;
      }
    } else if (karakter === '"') {
      tirnakIcinde = true;
    } else if (karakter === ',') {
      alanlar.push(alan);
      alan = '';
    } else if (karakter === '\n' || karakter === '\r') {
      if (karakter === '\r' && icerik[i + 1] === '\n') i++;
      satiriBitir();
    } else {
      alan += karakter;
    }
  }
  satiriBitir();
  return satirlar;
}

export function dosyaAdiTemizle(ad: string): string {
  return ad
    .trim()
    .replace(/\.png$/i, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();
}

export function listeYukle(yol: string): Satir[] {
  const ham = csvAyristir(readFileSync(yol, 'utf-8'));
  if (ham.length === 0) throw new Error(`liste dosyası boş: ${yol}`);

  const baslik = ham[0].map((sutun) => sutun.trim().toLowerCase());
  const metinIdx = baslik.indexOf('metin');
  const dosyaIdx = baslik.indexOf('dosya_adi');
  if (metinIdx === -1 || dosyaIdx === -1) {
    throw new Error('liste.csv başlığı "metin,dosya_adi" sütunlarını içermeli');
  }

  const satirlar: Satir[] = [];
  const gorulenAdlar = new Set<string>();
  for (let i = 1; i < ham.length; i++) {
    const metin = (ham[i][metinIdx] ?? '').trim();
    const dosyaAdi = dosyaAdiTemizle(ham[i][dosyaIdx] ?? '');
    if (metin === '' || dosyaAdi === '') {
      throw new Error(`liste.csv ${i + 1}. satır: "metin" ve "dosya_adi" boş olamaz`);
    }
    if (gorulenAdlar.has(dosyaAdi)) {
      throw new Error(`liste.csv ${i + 1}. satır: "${dosyaAdi}" dosya adı tekrar ediyor`);
    }
    gorulenAdlar.add(dosyaAdi);
    satirlar.push({ metin, dosyaAdi });
  }
  return satirlar;
}
