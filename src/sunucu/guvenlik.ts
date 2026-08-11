import { randomBytes } from 'node:crypto';

export interface YetkiGirdisi {
  token?: string;
  origin?: string;
}

export interface YetkiBeklentisi {
  token: string;
  izinliOrigin: string;
}

/**
 * Yerel sunucu kullanıcının ChatGPT oturumunu süren bir tarayıcıyı kontrol ediyor.
 * Kullanıcı kötü niyetli bir siteyi gezerken o sitenin JavaScript'i 127.0.0.1'e
 * istek atabilir; token ve Origin kontrolü bunu engeller.
 */
export function istekYetkili(girdi: YetkiGirdisi, beklenen: YetkiBeklentisi): boolean {
  if (girdi.token !== beklenen.token) return false;
  if (girdi.origin !== undefined && girdi.origin !== beklenen.izinliOrigin) return false;
  return true;
}

export function tokenUret(): string {
  return randomBytes(24).toString('base64url');
}
