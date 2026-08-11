import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { gercekYolIcerdeMi, icerdeMi } from '../depo/yollar.js';
import type { Proje, ProjeDepo } from '../depo/projeDepo.js';
import { projeDogrula } from '../depo/projeDepo.js';
import type { IsYoneticisi } from '../is/isYoneticisi.js';
import { onizlemeUret, yerTutucuVarMi } from '../prompt.js';
import type { Satir } from '../tipler.js';
import { istekYetkili } from './guvenlik.js';

export interface SunucuBagimliliklari {
  depo: ProjeDepo;
  isYoneticisi: IsYoneticisi;
  isBaslat: (proje: Proje) => void;
  /** Tarayıcıyı iş başlatmadan açar — kullanıcı ChatGPT'ye giriş yapabilsin diye. */
  tarayiciAc: () => Promise<void>;
  tarayiciAcikMi: () => boolean;
  token: string;
  izinliOrigin: () => string;
  ciktiKoku: string;
  webKlasoru: string;
  klasoruAc: (yol: string) => void;
}

declare module 'fastify' {
  interface FastifyInstance {
    testIsYoneticisi: IsYoneticisi;
  }
}

const MESGUL_DURUMLAR = ['calisiyor', 'duraklatildi', 'limitBekliyor', 'kullaniciBekliyor'];

export function sunucuOlustur(b: SunucuBagimliliklari): FastifyInstance {
  const uygulama = Fastify({ logger: false });
  uygulama.decorate('testIsYoneticisi', b.isYoneticisi);

  // Tarayıcı, gövdesi olmayan POST'larda bile `content-type: application/json`
  // gönderir. Fastify'ın varsayılan ayrıştırıcısı boş gövdeyi 400 ile reddeder
  // (FST_ERR_CTP_EMPTY_JSON_BODY) ve tüm gövdesiz kontrol rotalarını bozar.
  // Boş gövdeyi `undefined` sayıyoruz; bozuk JSON hâlâ 400 döner.
  uygulama.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_istek, govde, bitir) => {
      const metin = typeof govde === 'string' ? govde.trim() : '';
      if (metin === '') {
        bitir(null, undefined);
        return;
      }
      try {
        bitir(null, JSON.parse(metin));
      } catch {
        const hata = new Error('gövde geçerli JSON değil') as Error & { statusCode?: number };
        hata.statusCode = 400;
        bitir(hata, undefined);
      }
    },
  );

  uygulama.addHook('onRequest', async (istek, yanit) => {
    const sorgu = istek.query as Record<string, string | undefined>;
    const basliktan = istek.headers['x-token'];
    const token = typeof basliktan === 'string' ? basliktan : sorgu?.t;
    const origin = istek.headers.origin;

    if (!istekYetkili({ token, origin }, { token: b.token, izinliOrigin: b.izinliOrigin() })) {
      // `return` şart: yanıtı göndermek tek başına istek yaşam döngüsünü
      // durdurmayı garanti etmez. Döndürmezsek rota işleyicisinin çalışması
      // Fastify'ın örtük "yanıt gönderildi" algılamasına kalır — yetkisiz
      // istek 401 görürken arka planda iş başlatabilirdi.
      return yanit.code(401).send({ hata: 'yetkisiz istek' });
    }
  });

  uygulama.get('/', async (_istek, yanit) => {
    const html = readFileSync(join(b.webKlasoru, 'index.html'), 'utf-8');
    return yanit.type('text/html; charset=utf-8').send(html);
  });

  uygulama.get('/api/proje', async () => b.depo.oku(b.ciktiKoku));

  uygulama.put('/api/proje', async (istek, yanit) => {
    if (mesgulMu(b.isYoneticisi)) {
      return yanit.code(409).send({ hata: 'iş çalışırken proje değiştirilemez' });
    }
    // Boş gövde artık ayrıştırıcıda `undefined` oluyor; açıkça reddet, yoksa
    // projeDogrula varsayılanları döndürüp kullanıcının projesini sessizce ezerdi.
    if (istek.body === undefined || istek.body === null) {
      return yanit.code(400).send({ hata: 'proje gövdesi gerekli' });
    }
    try {
      const proje = projeDogrula(istek.body, b.ciktiKoku);
      b.depo.yaz(proje);
      return b.depo.oku(b.ciktiKoku);
    } catch (hata) {
      return yanit.code(400).send({ hata: (hata as Error).message });
    }
  });

  uygulama.post('/api/proje/onizleme', async (istek) => {
    const govde = (istek.body ?? {}) as { basePrompt?: string; satirlar?: Satir[] };
    const basePrompt = govde.basePrompt ?? '';
    const satirlar = Array.isArray(govde.satirlar) ? govde.satirlar : [];
    return {
      yerTutucuVar: yerTutucuVarMi(basePrompt),
      onizleme: onizlemeUret(basePrompt, satirlar),
    };
  });

  uygulama.get('/api/tarayici', async () => ({ acik: b.tarayiciAcikMi() }));

  uygulama.post('/api/tarayici/ac', async (_istek, yanit) => {
    if (b.tarayiciAcikMi()) return { acik: true };
    try {
      await b.tarayiciAc();
      return { acik: b.tarayiciAcikMi() };
    } catch (hata) {
      return yanit.code(500).send({ hata: (hata as Error).message });
    }
  });

  uygulama.get('/api/is', async () => b.isYoneticisi.bilgi());

  uygulama.post('/api/is/baslat', async (_istek, yanit) => {
    if (mesgulMu(b.isYoneticisi)) {
      return yanit.code(409).send({ hata: 'bir iş zaten çalışıyor' });
    }
    // Tarayıcı açık değilse iş başlatılmaz: kullanıcının ChatGPT'ye giriş
    // yapacak bir anı olmalı, yoksa iş açılır açılmaz sohbete yazmaya başlar.
    if (!b.tarayiciAcikMi()) {
      return yanit.code(409).send({
        hata: 'Önce tarayıcıyı açıp ChatGPT\'ye giriş yapın',
      });
    }
    const proje = b.depo.oku(b.ciktiKoku);

    if (proje.satirlar.length === 0) {
      return yanit.code(400).send({ hata: 'listede hiç satır yok' });
    }
    if (!yerTutucuVarMi(proje.basePrompt)) {
      return yanit.code(400).send({
        hata: 'Prompt içinde {VARYASYON} yok — her satır aynı görseli üretirdi',
      });
    }

    b.isBaslat(proje);
    return yanit.code(202).send({ baslatildi: true });
  });

  for (const [yol, eylem] of [
    ['duraklat', () => b.isYoneticisi.duraklat()],
    ['devam', () => b.isYoneticisi.devam()],
    ['durdur', () => b.isYoneticisi.durdur()],
    ['kullanici-hazir', () => b.isYoneticisi.kullaniciHazir()],
  ] as const) {
    uygulama.post(`/api/is/${yol}`, async () => {
      eylem();
      return b.isYoneticisi.bilgi();
    });
  }

  uygulama.get('/api/is/akis', (istek, yanit) => {
    yanit.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const yaz = (veri: unknown) => {
      if (!yanit.raw.writableEnded) yanit.raw.write(`data: ${JSON.stringify(veri)}\n\n`);
    };

    const bilgi = b.isYoneticisi.bilgi();
    yaz({ tip: 'durum', durum: bilgi.durum, projeId: bilgi.projeId, ozet: bilgi.ozet });

    const sok = b.isYoneticisi.dinle(yaz);
    istek.raw.on('close', () => {
      sok();
      if (!yanit.raw.writableEnded) yanit.raw.end();
    });
  });

  uygulama.get('/api/galeri', async () => {
    const klasor = b.depo.oku(b.ciktiKoku).ciktiKlasoru;
    if (!existsSync(klasor)) return { dosyalar: [] };
    const dosyalar = readdirSync(klasor)
      .filter((ad) => ad.toLowerCase().endsWith('.png'))
      .sort();
    return { dosyalar };
  });

  uygulama.get('/api/gorsel/:ad', async (istek, yanit) => {
    const { ad } = istek.params as { ad: string };
    if (!ad.toLowerCase().endsWith('.png')) {
      return yanit.code(400).send({ hata: 'yalnızca png servis edilir' });
    }

    const klasor = b.depo.oku(b.ciktiKoku).ciktiKlasoru;
    const istenen = join(klasor, ad);

    // Önce sözdizimsel kontrol (ucuz, `..` gibi kaba denemeleri eler)
    if (!icerdeMi(klasor, istenen)) {
      return yanit.code(400).send({ hata: 'klasör dışına çıkılamaz' });
    }
    // Sonra symlink çözerek gerçek kontrol — `icerdeMi` symlink çözmez
    const yol = gercekYolIcerdeMi(klasor, istenen);
    if (yol === null) {
      return yanit.code(404).send({ hata: 'görsel bulunamadı' });
    }
    return yanit.type('image/png').send(readFileSync(yol));
  });

  uygulama.post('/api/klasoru-ac', async () => {
    const klasor = b.depo.oku(b.ciktiKoku).ciktiKlasoru;
    mkdirSync(klasor, { recursive: true });
    b.klasoruAc(klasor);
    return { acildi: true };
  });

  return uygulama;
}

export function mesgulMu(isYoneticisi: IsYoneticisi): boolean {
  return MESGUL_DURUMLAR.includes(isYoneticisi.bilgi().durum);
}
