import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjeDepo, varsayilanProje } from '../src/depo/projeDepo.js';
import { IsYoneticisi } from '../src/is/isYoneticisi.js';
import { sunucuOlustur } from '../src/sunucu/index.js';

/**
 * Yetkisiz isteğin 401 GÖRMESİ yeterli değil — rota işleyicisinin hiç
 * ÇALIŞMAMASI gerekir. Fastify'da async onRequest hook'u `reply.send()`
 * çağırıp değer döndürmezse istek yaşam döngüsü durmaz ve işleyici yine
 * çalışır: saldırgan 401 görür ama iş başlar, proje ezilir, klasör açılır.
 */

const TOKEN = 'test-token';
const ORIGIN = 'http://127.0.0.1:3000';

let kok: string;
let uygulama: ReturnType<typeof sunucuOlustur>;
let yanEtkiler: string[];

beforeEach(() => {
  kok = mkdtempSync(join(tmpdir(), 'yetki-yan-etki-'));
  const web = join(kok, 'web');
  mkdirSync(web, { recursive: true });
  writeFileSync(join(web, 'index.html'), '<h1>x</h1>', 'utf-8');

  yanEtkiler = [];

  const depo = new ProjeDepo(kok);
  depo.yaz({
    ...varsayilanProje(join(kok, 'cikti')),
    ad: 'Korunan proje',
    satirlar: [{ metin: 'karda', dosyaAdi: 'kedi_kar' }],
  });

  uygulama = sunucuOlustur({
    depo,
    isYoneticisi: new IsYoneticisi(),
    isBaslat: () => yanEtkiler.push('is-baslatildi'),
    tarayiciAc: async () => {
      yanEtkiler.push('tarayici-acildi');
    },
    tarayiciAcikMi: () => true,
    token: TOKEN,
    izinliOrigin: () => ORIGIN,
    ciktiKoku: join(kok, 'cikti'),
    webKlasoru: web,
    klasoruAc: () => yanEtkiler.push('klasor-acildi'),
  });
});

afterEach(async () => {
  await uygulama.close();
  rmSync(kok, { recursive: true, force: true });
});

/** Kötü niyetli sitenin gönderebileceği istek: token yok. */
const yetkisiz = () => ({ origin: 'https://kotu-site.com' });

describe('yetkisiz istek yan etki üretmemeli', () => {
  it('POST /api/is/baslat iş başlatmaz', async () => {
    const y = await uygulama.inject({ method: 'POST', url: '/api/is/baslat', headers: yetkisiz() });
    expect(y.statusCode).toBe(401);
    expect(yanEtkiler).toEqual([]);
  });

  it('POST /api/tarayici/ac tarayıcı açmaz', async () => {
    const y = await uygulama.inject({ method: 'POST', url: '/api/tarayici/ac', headers: yetkisiz() });
    expect(y.statusCode).toBe(401);
    expect(yanEtkiler).toEqual([]);
  });

  it('POST /api/klasoru-ac klasör açmaz', async () => {
    const y = await uygulama.inject({ method: 'POST', url: '/api/klasoru-ac', headers: yetkisiz() });
    expect(y.statusCode).toBe(401);
    expect(yanEtkiler).toEqual([]);
  });

  it('PUT /api/proje projeyi DEĞİŞTİRMEZ', async () => {
    const y = await uygulama.inject({
      method: 'PUT',
      url: '/api/proje',
      headers: { ...yetkisiz(), 'content-type': 'application/json' },
      payload: JSON.stringify({ ...varsayilanProje(join(kok, 'cikti')), ad: 'SALDIRGAN' }),
    });
    expect(y.statusCode).toBe(401);
    expect(new ProjeDepo(kok).oku(join(kok, 'cikti')).ad).toBe('Korunan proje');
  });

  it('yetkisiz istek 401 gövdesi döndürür, rota gövdesi değil', async () => {
    const y = await uygulama.inject({ method: 'GET', url: '/api/proje', headers: yetkisiz() });
    expect(y.statusCode).toBe(401);
    expect(y.json()).toEqual({ hata: 'yetkisiz istek' });
  });
});
