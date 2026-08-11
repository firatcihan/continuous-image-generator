import { execFile } from 'node:child_process';

export interface Calistirilacak {
  komut: string;
  argumanlar: string[];
}

export function klasorKomutu(platform: NodeJS.Platform, yol: string): Calistirilacak {
  if (platform === 'darwin') return { komut: 'open', argumanlar: ['-R', yol] };
  if (platform === 'win32') return { komut: 'explorer', argumanlar: [yol] };
  return { komut: 'xdg-open', argumanlar: [yol] };
}

/**
 * URL için ayrı komut: macOS'ta `open -R` dosyayı Finder'da gösterir, tarayıcı
 * açmaz. Windows'ta `start` bir kabuk builtin'i olduğu için `cmd /c` gerekir;
 * ikinci argüman (boş string) `start`'ın pencere başlığı beklentisini karşılar,
 * yoksa URL başlık sanılır.
 */
export function urlKomutu(platform: NodeJS.Platform, url: string): Calistirilacak {
  if (platform === 'darwin') return { komut: 'open', argumanlar: [url] };
  if (platform === 'win32') return { komut: 'cmd', argumanlar: ['/c', 'start', '', url] };
  return { komut: 'xdg-open', argumanlar: [url] };
}

/** Kabuk stringi kullanılmaz; yol argüman dizisiyle geçer, enjeksiyon yüzeyi yok. */
export function klasoruAc(yol: string): void {
  calistir(klasorKomutu(process.platform, yol));
}

export function urlAc(url: string): void {
  calistir(urlKomutu(process.platform, url));
}

function calistir({ komut, argumanlar }: Calistirilacak): void {
  execFile(komut, argumanlar, () => {
    // açılmazsa sessiz geç; kritik yol değil, kullanıcı adresi terminalden kopyalayabilir
  });
}
