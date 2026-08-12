import {
  existsSync, readdirSync, rmSync, rmdirSync, statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { icerdeMi } from './yollar.js';

/** Silme işlemleri (test enjeksiyonu için). */
export interface SilmeIslemleri {
  dosyaSil: (yol: string) => void;
  klasorSil: (yol: string) => void;
}

export interface GorselSilmeSonucu {
  silinen: number;
  silinemeyen: string[];
  korumaliKlasor: boolean;
}

const varsayilanIslemler: SilmeIslemleri = {
  dosyaSil: (yol) => rmSync(yol),
  klasorSil: (yol) => rmdirSync(yol),
};

/**
 * İki yolun aynı klasörü gösterip göstermediği. Yol metnini karşılaştırmak
 * yetmez: büyük/küçük harfe duyarsız dosya sistemlerinde (macOS varsayılanı)
 * /Users/x ile /users/x aynı klasördür ama metin olarak eşit değildir.
 * realpath da bunu düzeltmiyor — realpath sembolik bağları çözer, harf
 * kasasını normalize etmez. Bu yüzden dosya sisteminin kimliğini (aygıt +
 * inode) soruyoruz. `korumaliKokler` girdisi diskte yoksa hedef klasör
 * olamayacağı için hata yutuluyor.
 */
function ayniKlasorMu(a: string, b: string): boolean {
  if (resolve(a) === resolve(b)) return true;
  try {
    const x = statSync(a);
    const y = statSync(b);
    return x.dev === y.dev && x.ino === y.ino;
  } catch {
    return false;
  }
}

/**
 * Bir projenin çıktı klasöründeki görselleri siler.
 *
 * Kısıtlar bilinçli olarak dar: yanlış yapılandırılmış bir `ciktiKlasoru`
 * (ör. ev dizini) felakete dönmemeli.
 * - Yalnızca klasörün doğrudan içindeki `.png` dosyaları silinir
 * - Alt klasörlere inilmez, başka uzantıya dokunulmaz
 * - Symlink'in kendisi silinir; `rmSync` bağı izlemediği için hedef korunur
 * - Klasör `korumaliKokler`den biriyse hiçbir şey silinmez
 * - PNG'ler gittikten sonra klasör boşsa silinir, doluysa bırakılır
 */
export function klasorGorselleriniSil(
  klasor: string,
  korumaliKokler: string[],
  islemler: SilmeIslemleri = varsayilanIslemler,
): GorselSilmeSonucu {
  if (!existsSync(klasor)) {
    return { silinen: 0, silinemeyen: [], korumaliKlasor: false };
  }

  const hedef = resolve(klasor);
  if (korumaliKokler.some((kok) => ayniKlasorMu(kok, hedef))) {
    return { silinen: 0, silinemeyen: [], korumaliKlasor: true };
  }

  let silinen = 0;
  const silinemeyen: string[] = [];

  for (const giris of readdirSync(hedef, { withFileTypes: true })) {
    if (!giris.isFile() && !giris.isSymbolicLink()) continue;
    if (!giris.name.toLowerCase().endsWith('.png')) continue;

    const yol = join(hedef, giris.name);
    // readdir adları klasörden çıkamaz; yine de savunma katmanı bırakılıyor
    if (!icerdeMi(hedef, yol)) continue;

    try {
      islemler.dosyaSil(yol);
      silinen++;
    } catch {
      silinemeyen.push(giris.name);
    }
  }

  if (readdirSync(hedef).length === 0) {
    try {
      islemler.klasorSil(hedef);
    } catch {
      // klasörü silememek görsellerin silindiği gerçeğini değiştirmez
    }
  }

  return { silinen, silinemeyen, korumaliKlasor: false };
}
