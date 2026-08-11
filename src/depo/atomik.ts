import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

/** Dosya yazma/fsync işlemleri için interface (test enjeksiyonu için opsiyonel). */
export interface DosyaIslemleri {
  yaz: (fd: number, icerik: string) => void;
  esitle: (fd: number) => void;
}

const varsayilanDosyaIslemleri: DosyaIslemleri = {
  yaz: (fd: number, icerik: string) => writeSync(fd, icerik, 0, 'utf-8'),
  esitle: (fd: number) => fsyncSync(fd),
};

/**
 * Geçici dosyaya yazıp rename ile taşır. rename atomiktir; yazma sırasında
 * çökme olsa bile hedef dosya ya eski hali ya yeni hali olur, asla yarım kalmaz.
 * Yazma hatası olursa geçici dosyayı best-effort siler.
 *
 * @param yol Hedef dosya yolu
 * @param icerik Yazılacak içerik
 * @param islemler Opsiyonel dosya işlemleri (test için). Varsayılan: gerçek writeSync/fsyncSync
 */
export function atomikYaz(yol: string, icerik: string, islemler?: DosyaIslemleri): void {
  const _islemler = islemler || varsayilanDosyaIslemleri;

  const klasor = dirname(yol);
  mkdirSync(klasor, { recursive: true });

  const gecici = join(klasor, `.tmp-${process.pid}-${randomUUID()}-${basename(yol)}`);
  const fd = openSync(gecici, 'w');
  try {
    _islemler.yaz(fd, icerik);
    _islemler.esitle(fd);
  } catch (e) {
    // geçici dosyayı sil
    try {
      unlinkSync(gecici);
    } catch {
      // best-effort, hatasını yut
    }
    throw e;
  } finally {
    closeSync(fd);
  }
  renameSync(gecici, yol);
}
