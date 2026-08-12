import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjelerDepo } from '../src/depo/projeler.js';
import { IsYoneticisi } from '../src/is/isYoneticisi.js';
import { sunucuOlustur } from '../src/sunucu/index.js';

const TOKEN = 'test-token';
const ORIGIN = 'http://127.0.0.1:3000';

let kok: string;
let depo: ProjelerDepo;
let uygulama: ReturnType<typeof sunucuOlustur>;

beforeEach(() => {
  kok = mkdtempSync(join(tmpdir(), 'sunucu-projeler-'));
  const web = join(kok, 'web');
  mkdirSync(web, { recursive: true });
  writeFileSync(join(web, 'index.html'), '<h1>merhaba</h1>', 'utf-8');
  depo = new ProjelerDepo(kok, join(kok, 'cikti'));

  uygulama = sunucuOlustur({
    depo,
    isYoneticisi: new IsYoneticisi(),
    isBaslat: () => {},
    tarayiciAc: async () => {},
    tarayiciAcikMi: () => true,
    token: TOKEN,
    izinliOrigin: () => ORIGIN,
    webKlasoru: web,
    klasoruAc: () => {},
  });
});

afterEach(async () => {
  await uygulama.close();
  rmSync(kok, { recursive: true, force: true });
});

const yetkili = (ek: Record<string, string> = {}) => ({ 'x-token': TOKEN, origin: ORIGIN, ...ek });

describe('GET /', () => {
  it('web klasöründeki index.html dosyasını servis eder', async () => {
    const y = await uygulama.inject({ method: 'GET', url: `/?t=${TOKEN}` });
    expect(y.statusCode).toBe(200);
    expect(y.headers['content-type']).toContain('text/html');
    expect(y.body).toContain('merhaba');
  });
});

describe('GET /api/projeler', () => {
  it('proje yoksa boş liste döner', async () => {
    const y = await uygulama.inject({ method: 'GET', url: '/api/projeler', headers: yetkili() });
    expect(y.statusCode).toBe(200);
    expect(y.json()).toEqual({ projeler: [], bozukSayisi: 0 });
  });

  it('özet alanlarını döner, satırları taşımaz', async () => {
    depo.olustur('Kedi');
    const y = await uygulama.inject({ method: 'GET', url: '/api/projeler', headers: yetkili() });
    expect(y.json().projeler[0].ad).toBe('Kedi');
    expect(y.json().projeler[0]).not.toHaveProperty('satirlar');
  });
});

describe('POST /api/projeler', () => {
  it('ad ile proje oluşturur ve tam kaydı döner', async () => {
    const y = await uygulama.inject({
      method: 'POST', url: '/api/projeler', headers: yetkili(), payload: { ad: 'Kedi Serisi' },
    });
    expect(y.statusCode).toBe(201);
    expect(y.json().id.startsWith('kedi-serisi-')).toBe(true);
    expect(y.json().basePrompt).toContain('{VARYASYON}');
  });

  it('ad boşsa 400 döner', async () => {
    const y = await uygulama.inject({
      method: 'POST', url: '/api/projeler', headers: yetkili(), payload: { ad: '   ' },
    });
    expect(y.statusCode).toBe(400);
  });
});

describe('GET /api/projeler/:id', () => {
  it('tam kaydı döner', async () => {
    const p = depo.olustur('Kedi');
    const y = await uygulama.inject({
      method: 'GET', url: `/api/projeler/${p.id}`, headers: yetkili(),
    });
    expect(y.statusCode).toBe(200);
    expect(y.json().satirlar).toEqual([]);
  });

  it('bilinmeyen id için 404 döner', async () => {
    const y = await uygulama.inject({
      method: 'GET', url: '/api/projeler/yok-1111', headers: yetkili(),
    });
    expect(y.statusCode).toBe(404);
  });

  it('geçersiz id için 404 döner', async () => {
    const y = await uygulama.inject({
      method: 'GET', url: '/api/projeler/BUYUK.HARF', headers: yetkili(),
    });
    expect(y.statusCode).toBe(404);
  });
});

describe('PUT /api/projeler/:id', () => {
  it('kaydeder ve geri okur', async () => {
    const p = depo.olustur('Kedi');
    const yaz = await uygulama.inject({
      method: 'PUT', url: `/api/projeler/${p.id}`, headers: yetkili(),
      payload: { ...p, ad: 'Kedi 2', satirlar: [{ metin: 'karda', dosyaAdi: 'a' }] },
    });
    expect(yaz.statusCode).toBe(200);
    expect(depo.oku(p.id)?.ad).toBe('Kedi 2');
  });

  it('gövdedeki id\'yi yoksayar, yoldaki id kazanır', async () => {
    const p = depo.olustur('Kedi');
    const digeri = depo.olustur('Plaj');

    await uygulama.inject({
      method: 'PUT', url: `/api/projeler/${p.id}`, headers: yetkili(),
      payload: { ...p, id: digeri.id, ad: 'Ezilmeye çalışıldı' },
    });

    expect(depo.oku(digeri.id)?.ad).toBe('Plaj');
    expect(depo.oku(p.id)?.ad).toBe('Ezilmeye çalışıldı');
  });

  it('geçersiz gövdeyi 400 ile reddeder', async () => {
    const p = depo.olustur('Kedi');
    const y = await uygulama.inject({
      method: 'PUT', url: `/api/projeler/${p.id}`, headers: yetkili(),
      payload: { ...p, satirlar: [{ metin: '', dosyaAdi: 'a' }] },
    });
    expect(y.statusCode).toBe(400);
    expect(y.json().hata).toMatch(/boş olamaz/);
  });

  it('boş gövdeyi 400 ile reddeder', async () => {
    const p = depo.olustur('Kedi');
    const y = await uygulama.inject({
      method: 'PUT', url: `/api/projeler/${p.id}`, headers: yetkili(),
    });
    expect(y.statusCode).toBe(400);
  });

  it('başka projenin çıktı klasörünü 400 ile reddeder', async () => {
    const bir = depo.olustur('Kedi');
    const iki = depo.olustur('Plaj');
    const y = await uygulama.inject({
      method: 'PUT', url: `/api/projeler/${iki.id}`, headers: yetkili(),
      payload: { ...iki, ciktiKlasoru: bir.ciktiKlasoru },
    });
    expect(y.statusCode).toBe(400);
    expect(y.json().hata).toMatch(/Kedi/);
  });
});

describe('DELETE /api/projeler/:id', () => {
  it('görselleri silmeden kaydı siler', async () => {
    const p = depo.olustur('Kedi');
    mkdirSync(p.ciktiKlasoru, { recursive: true });
    writeFileSync(join(p.ciktiKlasoru, 'a.png'), 'x');

    const y = await uygulama.inject({
      method: 'DELETE', url: `/api/projeler/${p.id}`, headers: yetkili(),
    });

    expect(y.statusCode).toBe(200);
    expect(y.json().silinen).toBe(0);
    expect(depo.oku(p.id)).toBeNull();
    expect(existsSync(join(p.ciktiKlasoru, 'a.png'))).toBe(true);
  });

  it('gorselleriSil=1 ile görselleri de siler', async () => {
    const p = depo.olustur('Kedi');
    mkdirSync(p.ciktiKlasoru, { recursive: true });
    writeFileSync(join(p.ciktiKlasoru, 'a.png'), 'x');

    const y = await uygulama.inject({
      method: 'DELETE', url: `/api/projeler/${p.id}?gorselleriSil=1`, headers: yetkili(),
    });

    expect(y.json()).toEqual({ silinen: 1, silinemeyen: [], korumaliKlasor: false });
  });

  it('bilinmeyen id için 404 döner', async () => {
    const y = await uygulama.inject({
      method: 'DELETE', url: '/api/projeler/yok-1111', headers: yetkili(),
    });
    expect(y.statusCode).toBe(404);
  });
});

describe('POST /api/projeler/:id/onizleme', () => {
  it('ilk 3 satırın render edilmiş halini döner', async () => {
    const p = depo.olustur('Kedi');
    const y = await uygulama.inject({
      method: 'POST', url: `/api/projeler/${p.id}/onizleme`, headers: yetkili(),
      payload: {
        basePrompt: 'Bir kedi, {VARYASYON}, detaylı',
        satirlar: [
          { metin: 'karda', dosyaAdi: 'a' }, { metin: 'plajda', dosyaAdi: 'b' },
          { metin: 'ormanda', dosyaAdi: 'c' }, { metin: 'çölde', dosyaAdi: 'd' },
        ],
      },
    });
    expect(y.json().yerTutucuVar).toBe(true);
    expect(y.json().onizleme).toEqual([
      'Bir kedi, karda, detaylı', 'Bir kedi, plajda, detaylı', 'Bir kedi, ormanda, detaylı',
    ]);
  });

  it('yer tutucu yoksa yerTutucuVar false ve boş önizleme döner', async () => {
    const p = depo.olustur('Kedi');
    const y = await uygulama.inject({
      method: 'POST', url: `/api/projeler/${p.id}/onizleme`, headers: yetkili(),
      payload: { basePrompt: 'Bir kedi', satirlar: [{ metin: 'karda', dosyaAdi: 'a' }] },
    });
    expect(y.json().yerTutucuVar).toBe(false);
    expect(y.json().onizleme).toEqual([]);
  });
});

function isCalistir(uygulama: ReturnType<typeof sunucuOlustur>, projeId: string): void {
  void uygulama.testIsYoneticisi.baslat({
    projeId,
    config: {
      basePrompt: 'a {VARYASYON}', ciktiKlasoru: '/tmp', chromeProfil: '/tmp',
      modelAdi: '', satirArasiBekleme: [0, 0], uretimZamanAsimiSn: 1,
      tekrarDenemeSayisi: 1, rateLimitVarsayilanBeklemeDk: 1,
    },
    satirlar: [{ metin: 'a', dosyaAdi: 'a' }],
    tarayici: {
      baslat: async () => {}, yenidenBaslat: async () => {}, yeniSohbetAc: async () => {},
      oturumAcikMi: async () => true, aktifModelAdi: async () => '',
      gorselUret: () => new Promise(() => {}), // asılı kalır
      sonGorseliKaydet: async () => {}, kapat: async () => {},
    },
    logger: { bilgi: () => {}, uyari: () => {}, hata: () => {} } as never,
    tamamlandiMi: () => false,
    basarisizKaydet: () => {},
    uyuMotoru: async () => {},
  });
}

describe('çalışan proje kilidi', () => {
  it('çalışan projenin PUT ve DELETE isteğini 409 ile reddeder', async () => {
    const p = depo.olustur('Kedi');
    isCalistir(uygulama, p.id);
    await new Promise((c) => setTimeout(c, 10));

    const put = await uygulama.inject({
      method: 'PUT', url: `/api/projeler/${p.id}`, headers: yetkili(), payload: p,
    });
    const sil = await uygulama.inject({
      method: 'DELETE', url: `/api/projeler/${p.id}`, headers: yetkili(),
    });

    expect(put.statusCode).toBe(409);
    expect(sil.statusCode).toBe(409);
    uygulama.testIsYoneticisi.durdur();
  });

  it('çalışmayan başka projenin düzenlenmesine izin verir', async () => {
    const calisan = depo.olustur('Kedi');
    const digeri = depo.olustur('Plaj');
    isCalistir(uygulama, calisan.id);
    await new Promise((c) => setTimeout(c, 10));

    const put = await uygulama.inject({
      method: 'PUT', url: `/api/projeler/${digeri.id}`, headers: yetkili(),
      payload: { ...digeri, ad: 'Plaj 2' },
    });

    expect(put.statusCode).toBe(200);
    uygulama.testIsYoneticisi.durdur();
  });

  it('başka iş çalışırken yeni iş başlatmayı 409 ile reddeder', async () => {
    const calisan = depo.olustur('Kedi');
    const digeri = depo.olustur('Plaj');
    isCalistir(uygulama, calisan.id);
    await new Promise((c) => setTimeout(c, 10));

    const y = await uygulama.inject({
      method: 'POST', url: '/api/is/baslat', headers: yetkili(), payload: { projeId: digeri.id },
    });

    expect(y.statusCode).toBe(409);
    uygulama.testIsYoneticisi.durdur();
  });
});

describe('POST /api/is/baslat', () => {
  it('projeId yoksa 400 döner', async () => {
    const y = await uygulama.inject({
      method: 'POST', url: '/api/is/baslat', headers: yetkili(), payload: {},
    });
    expect(y.statusCode).toBe(400);
  });

  it('bilinmeyen projeId için 404 döner', async () => {
    const y = await uygulama.inject({
      method: 'POST', url: '/api/is/baslat', headers: yetkili(),
      payload: { projeId: 'yok-1111' },
    });
    expect(y.statusCode).toBe(404);
  });

  it('satır yoksa 400 döner', async () => {
    const p = depo.olustur('Kedi');
    const y = await uygulama.inject({
      method: 'POST', url: '/api/is/baslat', headers: yetkili(), payload: { projeId: p.id },
    });
    expect(y.statusCode).toBe(400);
    expect(y.json().hata).toMatch(/satır/);
  });

  it('yer tutucu yoksa 400 döner', async () => {
    const p = depo.olustur('Kedi');
    depo.yaz({ ...p, basePrompt: 'yer tutucusuz', satirlar: [{ metin: 'a', dosyaAdi: 'a' }] });
    const y = await uygulama.inject({
      method: 'POST', url: '/api/is/baslat', headers: yetkili(), payload: { projeId: p.id },
    });
    expect(y.statusCode).toBe(400);
    expect(y.json().hata).toMatch(/VARYASYON/);
  });

  it('geçerli projede 202 döner ve isBaslat çağrılır', async () => {
    let baslatilan = '';
    const kendiUygulama = sunucuOlustur({
      depo, isYoneticisi: new IsYoneticisi(),
      isBaslat: (proje) => { baslatilan = proje.id; },
      tarayiciAc: async () => {}, tarayiciAcikMi: () => true,
      token: TOKEN, izinliOrigin: () => ORIGIN,
      webKlasoru: join(kok, 'web'), klasoruAc: () => {},
    });
    const p = depo.olustur('Kedi');
    depo.yaz({ ...p, satirlar: [{ metin: 'a', dosyaAdi: 'a' }] });

    const y = await kendiUygulama.inject({
      method: 'POST', url: '/api/is/baslat', headers: yetkili(), payload: { projeId: p.id },
    });

    expect(y.statusCode).toBe(202);
    expect(baslatilan).toBe(p.id);
    await kendiUygulama.close();
  });
});

describe('POST /api/csv/ayristir', () => {
  it('CSV metnini satırlara çevirir', async () => {
    const y = await uygulama.inject({
      method: 'POST', url: '/api/csv/ayristir', headers: yetkili(),
      payload: { icerik: 'metin,dosya_adi\nkarda,a\n' },
    });
    expect(y.statusCode).toBe(200);
    expect(y.json().satirlar).toEqual([{ metin: 'karda', dosyaAdi: 'a' }]);
  });

  it('geçersiz CSV\'yi 400 ve satır numaralı mesajla reddeder', async () => {
    const y = await uygulama.inject({
      method: 'POST', url: '/api/csv/ayristir', headers: yetkili(),
      payload: { icerik: 'metin,dosya_adi\na,ayni\nb,ayni\n' },
    });
    expect(y.statusCode).toBe(400);
    expect(y.json().hata).toMatch(/tekrar/);
  });

  it('icerik yoksa 400 döner', async () => {
    const y = await uygulama.inject({
      method: 'POST', url: '/api/csv/ayristir', headers: yetkili(), payload: {},
    });
    expect(y.statusCode).toBe(400);
  });
});

describe('beklenmeyen dosya sistemi hatası', () => {
  it('ciktiKlasoru bir dosyayı gösteriyorsa 500 ve { hata } gövdesiyle döner', async () => {
    const p = depo.olustur('Kedi');
    const dosyaYolu = join(kok, 'bu-bir-klasor-degil');
    writeFileSync(dosyaYolu, 'x');

    const put = await uygulama.inject({
      method: 'PUT', url: `/api/projeler/${p.id}`, headers: yetkili(),
      payload: { ...p, ciktiKlasoru: dosyaYolu },
    });
    expect(put.statusCode).toBe(200);

    // readdirSync bir dosyaya karşı ENOTDIR fırlatır — hiçbir rota bunu
    // yakalamıyor, global setErrorHandler'a düşmesi gerekiyor.
    const y = await uygulama.inject({
      method: 'GET', url: `/api/projeler/${p.id}/galeri`, headers: yetkili(),
    });
    expect(y.statusCode).toBe(500);
    expect(typeof y.json().hata).toBe('string');
    expect(y.json().hata.length).toBeGreaterThan(0);
  });
});
