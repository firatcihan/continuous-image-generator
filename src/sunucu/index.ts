import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { idGecerliMi } from '../depo/kimlik.js';
import type { Proje, ProjelerDepo } from '../depo/projeler.js';
import { gercekYolIcerdeMi, icerdeMi } from '../depo/yollar.js';
import type { IsYoneticisi } from '../is/isYoneticisi.js';
import { satirlariAyristir } from '../liste.js';
import { onizlemeUret, yerTutucuVarMi } from '../prompt.js';
import type { Satir } from '../tipler.js';
import { cookieTokenOku, istekYetkili } from './guvenlik.js';

export interface SunucuBagimliliklari {
  depo: ProjelerDepo;
  isYoneticisi: IsYoneticisi;
  isBaslat: (proje: Proje) => void;
  /** Tarayıcıyı iş başlatmadan açar — kullanıcı ChatGPT'ye giriş yapabilsin diye. */
  tarayiciAc: () => Promise<void>;
  tarayiciAcikMi: () => boolean;
  token: string;
  izinliOrigin: () => string;
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

  // Beklenmeyen hata: gövde her rotayla aynı şekli taşımalı ({ hata }), yoksa
  // UI hatayı okuyamaz ve kullanıcı boş bir kutu görür. ciktiKlasoru
  // kullanıcıdan gelen serbest bir yol olduğu için bu yol gerçekten
  // erişilebilir (dosyayı klasör sanmak → ENOTDIR, izin yok → EACCES).
  //
  // `statusCode < 500` dalı yalnızca aşağıdaki `addContentTypeParser`'ın
  // kendi fırlattığı, mesajı bizim yazdığımız (bozuk JSON) hatayı korumak
  // için var — o hata zaten güvenli bir mesaj taşıyor ve 400 olarak
  // kalmalı. `statusCode`'u olmayan (ör. fs çağrılarından gelen ENOTDIR/
  // EACCES) her şey burada "beklenmeyen" sayılır: ayrıntı yalnızca sunucu
  // konsoluna gider, çünkü fs hata mesajları mutlak yol içerebilir.
  uygulama.setErrorHandler((hata, istek, yanit) => {
    const bilinenHata = hata as Error & { statusCode?: number };
    if (typeof bilinenHata.statusCode === 'number' && bilinenHata.statusCode < 500) {
      return yanit.code(bilinenHata.statusCode).send({ hata: bilinenHata.message });
    }
    console.error(`${istek.method} ${istek.url} beklenmeyen hata:`, hata);
    return yanit.code(500).send({ hata: 'beklenmeyen sunucu hatası' });
  });

  /** Projeyi okur; yoksa 404 gönderir ve null döner. */
  const projeVeya404 = (id: string, yanit: FastifyReply): Proje | null => {
    const proje = idGecerliMi(id) ? b.depo.oku(id) : null;
    if (proje === null) {
      yanit.code(404).send({ hata: 'proje bulunamadı' });
      return null;
    }
    return proje;
  };

  /** Bu proje şu an üretim yapıyorsa true — düzenleme ve silme kilidi. */
  const projeCalisiyorMu = (id: string): boolean =>
    mesgulMu(b.isYoneticisi) && b.isYoneticisi.bilgi().projeId === id;

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
    // favicon token taşımaz ve 204 döndüğü için bilgi sızdırmaz; muaf
    // tutulmazsa her sayfa yüklemesinde konsola 401 basar. Muafiyet TAM yol
    // eşleşmesiyle sınırlı: `istek.url.startsWith('/favicon.ico')` gerçek bir
    // soket isteğinde `/favicon.ico/../api/projeler` gibi önekle başlayan
    // başka yolları da eşleştirir (Node'un http sunucusu `..` segmentlerini
    // normalize etmez; bu yalnızca `.inject()` testlerinde ya da tarayıcının
    // `fetch`/`URL` normalizasyonunda görünmez). Bugün başka hiçbir rota bu
    // önekle çakışmasa da bu, yönlendiricinin iç davranışına güvenmek olurdu
    // — sorgu dizesini atıp yol adının TAMAMINI karşılaştırıyoruz.
    const yolAdi = istek.url.split('?')[0];
    if (yolAdi === '/favicon.ico') return;

    const sorgu = istek.query as Record<string, string | undefined>;
    const basliktan = istek.headers['x-token'];
    const token =
      (typeof basliktan === 'string' ? basliktan : undefined) ??
      sorgu?.t ??
      cookieTokenOku(istek.headers.cookie);
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
    // Modül istekleri (`<script type="module" src="/js/…">`) query ya da
    // x-token taşımaz. SameSite=Strict sayesinde kötü niyetli bir sitenin
    // 127.0.0.1'e attığı istek bu çerezi göndermez.
    return yanit
      .header('set-cookie', `t=${b.token}; Path=/; SameSite=Strict`)
      .type('text/html; charset=utf-8')
      .send(html);
  });

  uygulama.get('/api/projeler', async () => b.depo.listele());

  uygulama.post('/api/projeler', async (istek, yanit) => {
    const govde = (istek.body ?? {}) as { ad?: unknown };
    const ad = typeof govde.ad === 'string' ? govde.ad.trim() : '';
    if (ad === '') return yanit.code(400).send({ hata: 'proje adı gerekli' });

    try {
      return yanit.code(201).send(b.depo.olustur(ad));
    } catch (hata) {
      return yanit.code(400).send({ hata: (hata as Error).message });
    }
  });

  uygulama.get('/api/projeler/:id', async (istek, yanit) => {
    const { id } = istek.params as { id: string };
    const proje = projeVeya404(id, yanit);
    return proje === null ? yanit : proje;
  });

  uygulama.put('/api/projeler/:id', async (istek, yanit) => {
    const { id } = istek.params as { id: string };
    const mevcut = projeVeya404(id, yanit);
    if (mevcut === null) return yanit;

    if (projeCalisiyorMu(id)) {
      return yanit.code(409).send({ hata: 'bu proje çalışıyor; önce durdurun' });
    }
    // Boş gövde ayrıştırıcıda `undefined` oluyor; açıkça reddet, yoksa
    // projeDogrula varsayılanları döndürüp kullanıcının projesini ezerdi.
    if (istek.body === undefined || istek.body === null) {
      return yanit.code(400).send({ hata: 'proje gövdesi gerekli' });
    }

    try {
      // Yoldaki id kazanır: gövdedeki id ile başka bir projenin üzerine yazılamaz.
      return b.depo.guncelle(id, istek.body);
    } catch (hata) {
      return yanit.code(400).send({ hata: (hata as Error).message });
    }
  });

  uygulama.delete('/api/projeler/:id', async (istek, yanit) => {
    const { id } = istek.params as { id: string };
    if (projeVeya404(id, yanit) === null) return yanit;

    if (projeCalisiyorMu(id)) {
      return yanit.code(409).send({ hata: 'bu proje çalışıyor; önce durdurun' });
    }

    const sorgu = istek.query as { gorselleriSil?: string };
    const sonuc = b.depo.sil(id, sorgu.gorselleriSil === '1');
    return {
      silinen: sonuc.silinen,
      silinemeyen: sonuc.silinemeyen,
      korumaliKlasor: sonuc.korumaliKlasor,
    };
  });

  uygulama.post('/api/projeler/:id/onizleme', async (istek, yanit) => {
    const { id } = istek.params as { id: string };
    if (projeVeya404(id, yanit) === null) return yanit;

    const govde = (istek.body ?? {}) as { basePrompt?: string; satirlar?: Satir[] };
    const basePrompt = govde.basePrompt ?? '';
    const satirlar = Array.isArray(govde.satirlar) ? govde.satirlar : [];
    return {
      yerTutucuVar: yerTutucuVarMi(basePrompt),
      onizleme: onizlemeUret(basePrompt, satirlar),
    };
  });

  uygulama.get('/api/projeler/:id/galeri', async (istek, yanit) => {
    const { id } = istek.params as { id: string };
    const proje = projeVeya404(id, yanit);
    if (proje === null) return yanit;

    if (!existsSync(proje.ciktiKlasoru)) return { dosyalar: [], toplamBayt: 0 };

    const dosyalar = readdirSync(proje.ciktiKlasoru)
      .filter((ad) => ad.toLowerCase().endsWith('.png'))
      .sort();

    // Silme diyaloğu "48 görsel (12,4 MB)" satırını buradan besler; istemci tahmin etmez.
    let toplamBayt = 0;
    for (const ad of dosyalar) {
      try {
        toplamBayt += statSync(join(proje.ciktiKlasoru, ad)).size;
      } catch {
        // dosya arada silinmiş olabilir; toplamı bozmadan geç
      }
    }
    return { dosyalar, toplamBayt };
  });

  uygulama.get('/api/projeler/:id/gorsel/:ad', async (istek, yanit) => {
    const { id, ad } = istek.params as { id: string; ad: string };
    const proje = projeVeya404(id, yanit);
    if (proje === null) return yanit;

    if (!ad.toLowerCase().endsWith('.png')) {
      return yanit.code(400).send({ hata: 'yalnızca png servis edilir' });
    }

    const klasor = proje.ciktiKlasoru;
    const istenen = join(klasor, ad);

    // Önce sözdizimsel kontrol (ucuz, `..` gibi kaba denemeleri eler)
    if (!icerdeMi(klasor, istenen)) {
      return yanit.code(400).send({ hata: 'klasör dışına çıkılamaz' });
    }
    // Sonra symlink çözerek gerçek kontrol — `icerdeMi` symlink çözmez
    const yol = gercekYolIcerdeMi(klasor, istenen);
    if (yol === null) return yanit.code(404).send({ hata: 'görsel bulunamadı' });

    return yanit.type('image/png').send(readFileSync(yol));
  });

  uygulama.post('/api/projeler/:id/klasoru-ac', async (istek, yanit) => {
    const { id } = istek.params as { id: string };
    const proje = projeVeya404(id, yanit);
    if (proje === null) return yanit;

    mkdirSync(proje.ciktiKlasoru, { recursive: true });
    b.klasoruAc(proje.ciktiKlasoru);
    return { acildi: true };
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

  // CSV ayrıştırma tek yerde: tarayıcıda ikinci bir ayrıştırıcı olsa kopyalar
  // zamanla ayrışır ve kullanıcının CSV'si tarayıcıda geçip sunucuda reddedilirdi.
  uygulama.post('/api/csv/ayristir', async (istek, yanit) => {
    const govde = (istek.body ?? {}) as { icerik?: unknown };
    if (typeof govde.icerik !== 'string') {
      return yanit.code(400).send({ hata: 'icerik metni gerekli' });
    }
    try {
      return { satirlar: satirlariAyristir(govde.icerik) };
    } catch (hata) {
      return yanit.code(400).send({ hata: (hata as Error).message });
    }
  });

  uygulama.post('/api/is/baslat', async (istek, yanit) => {
    if (mesgulMu(b.isYoneticisi)) {
      return yanit.code(409).send({ hata: 'bir iş zaten çalışıyor' });
    }

    const govde = (istek.body ?? {}) as { projeId?: unknown };
    if (typeof govde.projeId !== 'string') {
      return yanit.code(400).send({ hata: 'projeId gerekli' });
    }
    const proje = projeVeya404(govde.projeId, yanit);
    if (proje === null) return yanit;

    // Tarayıcı açık değilse iş başlatılmaz: kullanıcının ChatGPT'ye giriş
    // yapacak bir anı olmalı, yoksa iş açılır açılmaz sohbete yazmaya başlar.
    if (!b.tarayiciAcikMi()) {
      return yanit.code(409).send({ hata: 'Önce tarayıcıyı açıp ChatGPT\'ye giriş yapın' });
    }
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

  const IZINLI_TURLER: Record<string, string> = {
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
  };

  const varlikServisEt = (altKlasor: string, ad: string, yanit: FastifyReply) => {
    const uzanti = ad.slice(ad.lastIndexOf('.')).toLowerCase();
    const tur = IZINLI_TURLER[uzanti];
    if (tur === undefined) {
      return yanit.code(400).send({ hata: 'bu dosya türü servis edilmiyor' });
    }

    const kok = join(b.webKlasoru, altKlasor);
    const istenen = join(kok, ad);
    // Önce sözdizimsel kontrol (ucuz, `..` gibi kaba denemeleri eler)
    if (!icerdeMi(kok, istenen)) {
      return yanit.code(400).send({ hata: 'web klasörü dışına çıkılamaz' });
    }
    // Sonra symlink çözerek gerçek kontrol — `icerdeMi` symlink çözmez
    const yol = gercekYolIcerdeMi(kok, istenen);
    if (yol === null) return yanit.code(404).send({ hata: 'dosya bulunamadı' });

    return yanit.type(tur).send(readFileSync(yol, 'utf-8'));
  };

  uygulama.get('/js/:ad', async (istek, yanit) =>
    varlikServisEt('js', (istek.params as { ad: string }).ad, yanit));

  uygulama.get('/css/:ad', async (istek, yanit) =>
    varlikServisEt('css', (istek.params as { ad: string }).ad, yanit));

  uygulama.get('/favicon.ico', async (_istek, yanit) => yanit.code(204).send());

  return uygulama;
}

export function mesgulMu(isYoneticisi: IsYoneticisi): boolean {
  return MESGUL_DURUMLAR.includes(isYoneticisi.bilgi().durum);
}
