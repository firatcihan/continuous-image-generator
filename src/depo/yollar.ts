import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { realpathSync, statSync } from 'node:fs';

export const VARSAYILAN_VERI_KOKU = join(homedir(), '.chatgpt-gorsel-uretici');
export const VARSAYILAN_CIKTI_KOKU = join(homedir(), 'ChatGPT-Gorseller');

export function projelerKlasoru(veriKoku: string): string {
  return join(veriKoku, 'projeler');
}

export function projeDosyaYolu(veriKoku: string, id: string): string {
  return join(projelerKlasoru(veriKoku), `${id}.json`);
}

/** Faz 2A'nın tekil proje dosyası — yalnızca göç kontrolü için. */
export function eskiProjeYolu(veriKoku: string): string {
  return join(veriKoku, 'proje.json');
}

export function chromeProfilYolu(veriKoku: string): string {
  return join(veriKoku, 'chrome_profil');
}

/**
 * Sözdizimsel olarak: `aday` normalize edildiğinde `kok` içinde kalıyor mu?
 * Path traversal savunması. Sembolik bağlantıları çözmez; gerçek dosya erişimi
 * için `gercekYolIcerdeMi()` kullan.
 */
export function icerdeMi(kok: string, aday: string): boolean {
  const fark = relative(resolve(kok), resolve(aday));
  if (fark === '') return true;                         // adayın kendisi kök
  if (fark === '..' || fark.startsWith('..' + sep)) return false;  // kökün dışına çıkıyor
  if (isAbsolute(fark)) return false;                   // farklı sürücü (Windows)
  return true;
}

/**
 * Gerçek dosya erişimi için: sembolik bağlantıları çözerek adayın kök içinde
 * kaldığını doğrular. Aday yoksa null döner.
 */
export function gercekYolIcerdeMi(kok: string, aday: string): string | null {
  try {
    const gercekAday = realpathSync(aday);
    const gercekKok = realpathSync(kok);
    if (icerdeMi(gercekKok, gercekAday)) {
      return gercekAday;
    }
    return null;
  } catch {
    // aday yoksa null
    return null;
  }
}

/**
 * İki yolun aynı klasörü gösterip göstermediği. Yol metnini (resolve sonrası)
 * karşılaştırmak yetmez: büyük/küçük harfe duyarsız dosya sistemlerinde
 * (macOS ve Windows varsayılanı) `/Users/x` ile `/users/x` aynı klasördür
 * ama metin olarak eşit değildir. `realpath` da bunu düzeltmiyor — sembolik
 * bağları çözer, harf kasasını normalize etmez. Bu yüzden dosya sisteminin
 * kimliğine (aygıt + inode) bakılıyor. Klasörlerden biri diskte yoksa (henüz
 * üretilmemiş çıktı klasörü ya da artık var olmayan bir korumalı kök) hata
 * yutulup false dönülüyor — böyle durumda zaten çakışacak bir şey yoktur.
 */
export function ayniKlasorMu(a: string, b: string): boolean {
  if (resolve(a) === resolve(b)) return true;
  try {
    const x = statSync(a);
    const y = statSync(b);
    return x.dev === y.dev && x.ino === y.ino;
  } catch {
    return false;
  }
}
