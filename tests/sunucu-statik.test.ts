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
    expect([400, 404]).toContain(y.statusCode);
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
