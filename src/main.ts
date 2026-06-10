import { mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { uyu } from './bekleme.js';
import { configYukle } from './config.js';
import { basarisizKaydet, tamamlandiMi } from './durum.js';
import { listeYukle } from './liste.js';
import { Logger } from './logger.js';
import { ChatgptTarayicisi } from './tarayici.js';
import { tumSatirlariIsle } from './worker.js';

async function main(): Promise<void> {
  const configYolu = process.argv[2] ?? './config.json';
  const listeYolu = process.argv[3] ?? './liste.csv';

  const config = configYukle(configYolu);
  const satirlar = listeYukle(listeYolu);
  mkdirSync(config.ciktiKlasoru, { recursive: true });

  const logger = new Logger('./calisma.log');
  logger.bilgi(`başlıyor: ${satirlar.length} satır, çıktı klasörü: ${config.ciktiKlasoru}`);

  const okuyucu = createInterface({ input: process.stdin, output: process.stdout });
  const tarayici = new ChatgptTarayicisi(config.chromeProfil);
  await tarayici.baslat();

  try {
    const ozet = await tumSatirlariIsle(
      {
        config,
        tarayici,
        logger,
        uyu,
        tamamlandiMi: (dosyaAdi) => tamamlandiMi(config.ciktiKlasoru, dosyaAdi),
        basarisizKaydet: (satir, sebep) => basarisizKaydet('./basarisizlar.csv', satir, sebep),
        kullanicidanDevamBekle: async (mesaj) => {
          await okuyucu.question(`\n${mesaj}\n[Enter] > `);
        },
      },
      satirlar,
    );
    logger.bilgi(
      `bitti — başarılı: ${ozet.basarili}, atlanan: ${ozet.atlanan}, başarısız: ${ozet.basarisiz}`,
    );
  } finally {
    okuyucu.close();
    await tarayici.kapat();
  }
}

main().catch((hata) => {
  console.error(`ölümcül hata: ${(hata as Error).message}`);
  process.exit(1);
});
