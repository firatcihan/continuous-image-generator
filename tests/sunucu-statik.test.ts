import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjelerDepo } from '../src/depo/projeler.js';
import { IsYoneticisi } from '../src/is/isYoneticisi.js';
import { sunucuOlustur } from '../src/sunucu/index.js';

const TOKEN = 'test-token';
const ORIGIN = 'http://127.0.0.1:3000';

let kok: string;
let uygulama: ReturnType<typeof sunucuOlustur>;

beforeEach(() => {
  kok = mkdtempSync(join(tmpdir(), 'sunucu-statik-'));
  const web = join(kok, 'web');
  mkdirSync(join(web, 'js'), { recursive: true });
  mkdirSync(join(web, 'css'), { recursive: true });
  writeFileSync(join(web, 'index.html'), '<h1>merhaba</h1>', 'utf-8');
  writeFileSync(join(web, 'js', 'api.js'), 'export const x = 1;', 'utf-8');
  writeFileSync(join(web, 'css', 'stil.css'), 'body{}', 'utf-8');
  writeFileSync(join(kok, 'gizli.txt'), 'sır', 'utf-8');

  uygulama = sunucuOlustur({
    depo: new ProjelerDepo(kok, join(kok, 'cikti')),
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

describe('GET / cookie', () => {
  it('token\'ı SameSite=Strict çerezi olarak verir', async () => {
    const y = await uygulama.inject({ method: 'GET', url: `/?t=${TOKEN}` });
    expect(y.statusCode).toBe(200);
    const cerez = String(y.headers['set-cookie']);
    expect(cerez).toContain(`t=${TOKEN}`);
    expect(cerez).toContain('SameSite=Strict');
    expect(cerez).toContain('Path=/');
  });
});

describe('çerez ile yetki', () => {
  it('modül isteğini çerezle kabul eder', async () => {
    const y = await uygulama.inject({
      method: 'GET', url: '/js/api.js', headers: { cookie: `t=${TOKEN}` },
    });
    expect(y.statusCode).toBe(200);
    expect(y.headers['content-type']).toContain('text/javascript');
    expect(y.body).toContain('export const x');
  });

  it('çerezsiz modül isteğini 401 ile reddeder', async () => {
    const y = await uygulama.inject({ method: 'GET', url: '/js/api.js' });
    expect(y.statusCode).toBe(401);
  });

  it('yanlış çerezi reddeder', async () => {
    const y = await uygulama.inject({
      method: 'GET', url: '/js/api.js', headers: { cookie: 't=yanlis' },
    });
    expect(y.statusCode).toBe(401);
  });

  it('API isteğini de çerezle kabul eder', async () => {
    const y = await uygulama.inject({
      method: 'GET', url: '/api/projeler', headers: { cookie: `t=${TOKEN}`, origin: ORIGIN },
    });
    expect(y.statusCode).toBe(200);
  });

  // Çerez geçerli olsa bile Origin kontrolü hâlâ devrede olmalı — SameSite
  // yalnızca çapraz-SITE'ı keser, çapraz-PORT'u kesmez (bkz. onRequest
  // kancasındaki yorum), bu yüzden Origin kontrolünün orada bekçilik yapmaya
  // devam ettiğini ayrıca doğruluyoruz.
  it('çerez geçerli olsa da yabancı Origin\'i reddeder', async () => {
    const y = await uygulama.inject({
      method: 'GET', url: '/api/projeler',
      headers: { cookie: `t=${TOKEN}`, origin: 'http://127.0.0.1:9999' },
    });
    expect(y.statusCode).toBe(401);
  });
});

describe('çerez + sec-fetch-site', () => {
  it('çerez + same-origin kabul edilir', async () => {
    const y = await uygulama.inject({
      method: 'GET', url: '/js/api.js',
      headers: { cookie: `t=${TOKEN}`, 'sec-fetch-site': 'same-origin' },
    });
    expect(y.statusCode).toBe(200);
  });

  it('çerez + same-site (başka port) reddedilir', async () => {
    const y = await uygulama.inject({
      method: 'GET', url: '/js/api.js',
      headers: { cookie: `t=${TOKEN}`, 'sec-fetch-site': 'same-site' },
    });
    expect(y.statusCode).toBe(401);
  });

  it('çerez + sec-fetch-site başlığı yoksa kabul edilir (fail-open)', async () => {
    const y = await uygulama.inject({
      method: 'GET', url: '/js/api.js', headers: { cookie: `t=${TOKEN}` },
    });
    expect(y.statusCode).toBe(200);
  });

  it('x-token/sorgu ile gelen token\'a sec-fetch-site kısıtı uygulanmaz', async () => {
    const y = await uygulama.inject({
      method: 'GET', url: '/js/api.js',
      headers: { 'x-token': TOKEN, 'sec-fetch-site': 'same-site' },
    });
    expect(y.statusCode).toBe(200);
  });
});

describe('statik varlıklar', () => {
  it('css servis eder', async () => {
    const y = await uygulama.inject({
      method: 'GET', url: '/css/stil.css', headers: { cookie: `t=${TOKEN}` },
    });
    expect(y.statusCode).toBe(200);
    expect(y.headers['content-type']).toContain('text/css');
  });

  it('web klasörü dışına çıkmaya çalışan isteği reddeder', async () => {
    const y = await uygulama.inject({
      method: 'GET', url: '/js/..%2F..%2Fgizli.txt', headers: { cookie: `t=${TOKEN}` },
    });
    expect(y.statusCode).toBe(400);
    expect(y.body).not.toContain('sır');
  });

  // Yukarıdaki test uzantı kontrolünde durur (.txt izinli değil) — `icerdeMi`
  // ve `gercekYolIcerdeMi` silinse bile aynı sonucu (400) verirdi, yani
  // birinci katmanın gerçekten bir şeyi ENGELLEDİĞİ hiçbir şey kanıtlamıyor.
  // İzinli bir uzantıyla (.js) kodlanmış `..%2F` kullanan bu test, birinci
  // katmanı (icerdeMi) gerçekten tetikler.
  it('izinli uzantıyla bile kodlanmış ayraçla klasör dışına çıkamaz', async () => {
    writeFileSync(join(kok, 'gizli.js'), 'sır', 'utf-8');
    const y = await uygulama.inject({
      method: 'GET', url: '/js/..%2F..%2Fgizli.js', headers: { cookie: `t=${TOKEN}` },
    });
    expect(y.statusCode).toBe(400);
    expect(y.body).not.toContain('sır');
  });

  it('izinli uzantı dışındaki dosyayı reddeder', async () => {
    writeFileSync(join(kok, 'web', 'js', 'gizli.json'), '{}', 'utf-8');
    const y = await uygulama.inject({
      method: 'GET', url: '/js/gizli.json', headers: { cookie: `t=${TOKEN}` },
    });
    expect(y.statusCode).toBe(400);
  });

  it('olmayan dosya için 404 döner', async () => {
    const y = await uygulama.inject({
      method: 'GET', url: '/js/yok.js', headers: { cookie: `t=${TOKEN}` },
    });
    expect(y.statusCode).toBe(404);
  });

  // Verilen "izinli uzantı dışındaki dosyayı reddeder" testi sözdizimsel
  // katmana (icerdeMi) hiç uğramadan extension kontrolünde durur (.json zaten
  // izinli değil). Bu yüzden `icerdeMi`'nin gerçekten bir şeyi ENGELLEDİĞİ
  // hiçbir senaryo egzersiz edilmemiş oluyor. İzinli bir uzantıyla (.js)
  // klasör dışına symlink kuran bu test, ikinci katmanı (gercekYolIcerdeMi)
  // gerçekten tetikler.
  it('web klasörü dışına çıkan symlink\'i izinli uzantıyla bile reddeder', async () => {
    symlinkSync(join(kok, 'gizli.txt'), join(kok, 'web', 'js', 'tuzak.js'));
    const y = await uygulama.inject({
      method: 'GET', url: '/js/tuzak.js', headers: { cookie: `t=${TOKEN}` },
    });
    expect(y.statusCode).toBe(404);
    expect(y.body).not.toContain('sır');
  });
});

describe('GET /favicon.ico', () => {
  it('tokensiz bile 204 döner — tarayıcı konsolunu kirletmesin', async () => {
    const y = await uygulama.inject({ method: 'GET', url: '/favicon.ico' });
    expect(y.statusCode).toBe(204);
  });

  // `istek.url.startsWith('/favicon.ico')` gibi bir önek kontrolü, gerçek bir
  // ham soket isteğinde `/favicon.icoX` ya da `/favicon.ico/../api/projeler`
  // gibi TAM eşleşmeyen yolları da muaf tutardı (Node'un http sunucusu `..`
  // segmentlerini normalize etmez ve bu, yalnızca `.inject()`/tarayıcı
  // `fetch` normalizasyonu ile MASKELENIR — production'da maskelenmez).
  // Muafiyet tam yol eşleşmesiyle sınırlı olduğu için token'sız bu istek
  // 404'e değil, açık 401'e düşmeli.
  it('favicon önekiyle başlayan ama tam eşleşmeyen yola muafiyet uygulanmaz', async () => {
    const y = await uygulama.inject({ method: 'GET', url: '/favicon.icoX' });
    expect(y.statusCode).toBe(401);
  });
});
