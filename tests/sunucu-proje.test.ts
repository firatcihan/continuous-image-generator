import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjeDepo, varsayilanProje } from '../src/depo/projeDepo.js';
import { IsYoneticisi } from '../src/is/isYoneticisi.js';
import { sunucuOlustur } from '../src/sunucu/index.js';

const TOKEN = 'test-token';
const ORIGIN = 'http://127.0.0.1:3000';

let kok: string;
let web: string;
let uygulama: ReturnType<typeof sunucuOlustur>;

beforeEach(() => {
  kok = mkdtempSync(join(tmpdir(), 'sunucu-test-'));
  web = join(kok, 'web');
  mkdirSync(web, { recursive: true });
  writeFileSync(join(web, 'index.html'), '<h1>merhaba</h1>', 'utf-8');

  uygulama = sunucuOlustur({
    depo: new ProjeDepo(kok),
    isYoneticisi: new IsYoneticisi(),
    isBaslat: () => {},
    tarayiciAc: async () => {},
    tarayiciAcikMi: () => true,
    token: TOKEN,
    izinliOrigin: () => ORIGIN,
    ciktiKoku: join(kok, 'cikti'),
    webKlasoru: web,
    klasoruAc: () => {},
  });
});

afterEach(async () => {
  await uygulama.close();
  rmSync(kok, { recursive: true, force: true });
});

const yetkili = (ek: Record<string, string> = {}) => ({ 'x-token': TOKEN, origin: ORIGIN, ...ek });

describe('güvenlik kapısı', () => {
  it('tokensiz API isteğini 401 ile reddeder', async () => {
    const y = await uygulama.inject({ method: 'GET', url: '/api/proje' });
    expect(y.statusCode).toBe(401);
  });

  it('yanlış tokenla reddeder', async () => {
    const y = await uygulama.inject({
      method: 'GET',
      url: '/api/proje',
      headers: { 'x-token': 'yanlis' },
    });
    expect(y.statusCode).toBe(401);
  });

  it('yabancı Origin ile reddeder', async () => {
    const y = await uygulama.inject({
      method: 'GET',
      url: '/api/proje',
      headers: yetkili({ origin: 'https://kotu-site.com' }),
    });
    expect(y.statusCode).toBe(401);
  });

  it('tokeni sorgu parametresinden de kabul eder', async () => {
    const y = await uygulama.inject({ method: 'GET', url: `/api/proje?t=${TOKEN}` });
    expect(y.statusCode).toBe(200);
  });
});

describe('GET /', () => {
  it('web klasöründeki index.html dosyasını servis eder', async () => {
    const y = await uygulama.inject({ method: 'GET', url: `/?t=${TOKEN}` });
    expect(y.statusCode).toBe(200);
    expect(y.headers['content-type']).toContain('text/html');
    expect(y.body).toContain('merhaba');
  });
});

describe('GET /api/proje', () => {
  it('kayıt yoksa varsayılan projeyi döner', async () => {
    const y = await uygulama.inject({ method: 'GET', url: '/api/proje', headers: yetkili() });
    expect(y.statusCode).toBe(200);
    expect(y.json().satirlar).toEqual([]);
    expect(y.json().basePrompt).toContain('{VARYASYON}');
  });
});

describe('PUT /api/proje', () => {
  it('geçerli projeyi kaydeder ve geri okur', async () => {
    const proje = { ...varsayilanProje(join(kok, 'cikti')), ad: 'Kedi serisi' };
    const yaz = await uygulama.inject({
      method: 'PUT',
      url: '/api/proje',
      headers: yetkili(),
      payload: proje,
    });
    expect(yaz.statusCode).toBe(200);

    const oku = await uygulama.inject({ method: 'GET', url: '/api/proje', headers: yetkili() });
    expect(oku.json().ad).toBe('Kedi serisi');
  });

  it('geçersiz projeyi 400 ve hata mesajıyla reddeder', async () => {
    const y = await uygulama.inject({
      method: 'PUT',
      url: '/api/proje',
      headers: yetkili(),
      payload: { satirlar: [{ metin: '', dosyaAdi: 'a' }] },
    });
    expect(y.statusCode).toBe(400);
    expect(y.json().hata).toMatch(/boş olamaz/);
  });

  it('iş çalışırken projeyi değiştirmeyi 409 ile reddeder', async () => {
    const yonetici = uygulama.testIsYoneticisi;
    // iş "calisiyor" durumuna sokulur
    void yonetici.baslat({
      projeId: 'x',
      config: {
        basePrompt: 'a {VARYASYON}', ciktiKlasoru: '/tmp', chromeProfil: '/tmp',
        modelAdi: '', satirArasiBekleme: [0, 0], uretimZamanAsimiSn: 1,
        tekrarDenemeSayisi: 1, rateLimitVarsayilanBeklemeDk: 1,
      },
      satirlar: [{ metin: 'a', dosyaAdi: 'a' }],
      tarayici: {
        baslat: async () => {}, yenidenBaslat: async () => {}, yeniSohbetAc: async () => {},
        oturumAcikMi: async () => true, aktifModelAdi: async () => '',
        gorselUret: () => new Promise(() => {}), // asılı kalır, iş çalışır durumda tutulur
        sonGorseliKaydet: async () => {}, kapat: async () => {},
      },
      logger: { bilgi: () => {}, uyari: () => {}, hata: () => {} } as never,
      tamamlandiMi: () => false,
      basarisizKaydet: () => {},
      uyuMotoru: async () => {},
    });
    await new Promise((c) => setTimeout(c, 10));

    const y = await uygulama.inject({
      method: 'PUT',
      url: '/api/proje',
      headers: yetkili(),
      payload: varsayilanProje(join(kok, 'cikti')),
    });
    expect(y.statusCode).toBe(409);
    yonetici.durdur();
  });
});

describe('POST /api/proje/onizleme', () => {
  it('ilk 3 satırın render edilmiş halini döner', async () => {
    const y = await uygulama.inject({
      method: 'POST',
      url: '/api/proje/onizleme',
      headers: yetkili(),
      payload: {
        basePrompt: 'Bir kedi, {VARYASYON}, detaylı',
        satirlar: [
          { metin: 'karda', dosyaAdi: 'a' },
          { metin: 'plajda', dosyaAdi: 'b' },
          { metin: 'ormanda', dosyaAdi: 'c' },
          { metin: 'çölde', dosyaAdi: 'd' },
        ],
      },
    });
    expect(y.statusCode).toBe(200);
    expect(y.json().yerTutucuVar).toBe(true);
    expect(y.json().onizleme).toEqual([
      'Bir kedi, karda, detaylı',
      'Bir kedi, plajda, detaylı',
      'Bir kedi, ormanda, detaylı',
    ]);
  });

  it('yer tutucu yoksa yerTutucuVar false ve boş önizleme döner', async () => {
    const y = await uygulama.inject({
      method: 'POST',
      url: '/api/proje/onizleme',
      headers: yetkili(),
      payload: { basePrompt: 'Bir kedi', satirlar: [{ metin: 'karda', dosyaAdi: 'a' }] },
    });
    expect(y.json().yerTutucuVar).toBe(false);
    expect(y.json().onizleme).toEqual([]);
  });
});
