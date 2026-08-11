import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';

export const VARSAYILAN_VERI_KOKU = join(homedir(), '.chatgpt-gorsel-uretici');
export const VARSAYILAN_CIKTI_KOKU = join(homedir(), 'ChatGPT-Gorseller');

export function projeYolu(veriKoku: string): string {
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
