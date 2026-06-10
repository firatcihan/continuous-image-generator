import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Satir } from './tipler.js';

export function ciktiYolu(ciktiKlasoru: string, dosyaAdi: string): string {
  return join(ciktiKlasoru, `${dosyaAdi}.png`);
}

export function tamamlandiMi(ciktiKlasoru: string, dosyaAdi: string): boolean {
  return existsSync(ciktiYolu(ciktiKlasoru, dosyaAdi));
}

export function basarisizKaydet(dosyaYolu: string, satir: Satir, sebep: string): void {
  if (!existsSync(dosyaYolu)) {
    appendFileSync(dosyaYolu, 'dosya_adi,metin,sebep\n', 'utf-8');
  }
  const kacis = (alan: string) => `"${alan.replaceAll('"', '""')}"`;
  appendFileSync(dosyaYolu, `${kacis(satir.dosyaAdi)},${kacis(satir.metin)},${kacis(sebep)}\n`, 'utf-8');
}
