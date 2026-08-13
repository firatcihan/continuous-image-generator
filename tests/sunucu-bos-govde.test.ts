import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjelerDepo, type Proje } from '../src/depo/projeler.js';
import { IsYoneticisi } from '../src/is/isYoneticisi.js';
import { sunucuOlustur } from '../src/sunucu/index.js';

/**
 * Tarayıcı, gövdesi olmayan POST isteklerinde bile `content-type: application/json`
 * gönderebilir. Fastify varsayılan olarak boş gövdeyi FST_ERR_CTP_EMPTY_JSON_BODY
 * ile 400 döndürür — bu, iş kontrol butonlarının tamamını (Başlat/Duraklat/Devam/
 * Durdur/kullanici-hazir/klasoru-ac) sessizce bozar.
 *
 * Bu testler tarayıcının gerçekte gönderdiğini taklit eder: content-type VAR, gövde YOK.
 */

const TOKEN = 'test-token';
const ORIGIN = 'http://127.0.0.1:3000';

let kok: string;
let p: Proje;
let uygulama: ReturnType<typeof sunucuOlustur>;

beforeEach(() => {
  kok = mkdtempSync(join(tmpdir(), 'bos-govde-'));
  const web = join(kok, 'web');
  mkdirSync(web, { recursive: true });
  writeFileSync(join(web, 'index.html'), '<h1>x</h1>', 'utf-8');

  const depo = new ProjelerDepo(kok, join(kok, 'cikti'));
  p = depo.olustur('Kedi');
  depo.yaz({ ...p, satirlar: [{ metin: 'karda', dosyaAdi: 'kedi_kar' }] });

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

/** Tarayıcının fetch'inin ürettiği başlıklar: content-type var, gövde yok. */
const tarayiciBasliklari = () => ({
  'x-token': TOKEN,
  origin: ORIGIN,
  'content-type': 'application/json',
});

describe('gövdesiz POST + content-type: application/json (tarayıcı davranışı)', () => {
  const GOVDESIZ_ROTALAR = [
    '/api/is/duraklat',
    '/api/is/devam',
    '/api/is/durdur',
    '/api/is/kullanici-hazir',
  ];

  for (const yol of GOVDESIZ_ROTALAR) {
    it(`${yol} boş gövdeyi 400 ile reddetmez`, async () => {
      const yanit = await uygulama.inject({
        method: 'POST',
        url: yol,
        headers: tarayiciBasliklari(),
      });
      expect(yanit.statusCode).not.toBe(400);
      expect(yanit.statusCode).toBeLessThan(400);
    });
  }

  it('/api/projeler/:id/klasoru-ac boş gövdeyi 400 ile reddetmez', async () => {
    const yanit = await uygulama.inject({
      method: 'POST',
      url: `/api/projeler/${p.id}/klasoru-ac`,
      headers: tarayiciBasliklari(),
    });
    expect(yanit.statusCode).not.toBe(400);
    expect(yanit.statusCode).toBeLessThan(400);
  });

  it('/api/is/baslat gövdesiz çağrıda projeId gerekli der', async () => {
    const yanit = await uygulama.inject({
      method: 'POST',
      url: '/api/is/baslat',
      headers: tarayiciBasliklari(),
    });
    expect(yanit.statusCode).toBe(400);
    expect(yanit.json().hata).toMatch(/projeId/);
  });

  it('gövdeli POST hâlâ normal ayrıştırılır', async () => {
    const yanit = await uygulama.inject({
      method: 'POST',
      url: `/api/projeler/${p.id}/onizleme`,
      headers: tarayiciBasliklari(),
      payload: JSON.stringify({
        basePrompt: 'Bir kedi, {VARYASYON}',
        satirlar: [{ metin: 'karda', dosyaAdi: 'a' }],
      }),
    });
    expect(yanit.statusCode).toBe(200);
    expect(yanit.json().onizleme).toEqual(['Bir kedi, karda']);
  });

  it('bozuk JSON gövdesi hâlâ 400 ile reddedilir', async () => {
    const yanit = await uygulama.inject({
      method: 'POST',
      url: `/api/projeler/${p.id}/onizleme`,
      headers: tarayiciBasliklari(),
      payload: '{ bozuk json',
    });
    expect(yanit.statusCode).toBe(400);
  });

  it('PUT /api/projeler/:id boş gövdeyle 400 döner (gerçekten gövde gerekiyor)', async () => {
    const yanit = await uygulama.inject({
      method: 'PUT',
      url: `/api/projeler/${p.id}`,
      headers: tarayiciBasliklari(),
    });
    // Boş gövde geçerli proje değil; doğrulama hatası beklenir, ayrıştırma çökmesi değil
    expect(yanit.statusCode).toBe(400);
    expect(yanit.json().hata).toBeTruthy();
  });
});
