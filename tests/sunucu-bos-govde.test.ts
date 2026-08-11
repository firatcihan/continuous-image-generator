import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjeDepo, varsayilanProje } from '../src/depo/projeDepo.js';
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
let uygulama: ReturnType<typeof sunucuOlustur>;

beforeEach(() => {
  kok = mkdtempSync(join(tmpdir(), 'bos-govde-'));
  const web = join(kok, 'web');
  mkdirSync(web, { recursive: true });
  writeFileSync(join(web, 'index.html'), '<h1>x</h1>', 'utf-8');

  const depo = new ProjeDepo(kok);
  depo.yaz({
    ...varsayilanProje(join(kok, 'cikti')),
    satirlar: [{ metin: 'karda', dosyaAdi: 'kedi_kar' }],
  });

  uygulama = sunucuOlustur({
    depo,
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

/** Tarayıcının fetch'inin ürettiği başlıklar: content-type var, gövde yok. */
const tarayiciBasliklari = () => ({
  'x-token': TOKEN,
  origin: ORIGIN,
  'content-type': 'application/json',
});

describe('gövdesiz POST + content-type: application/json (tarayıcı davranışı)', () => {
  const GOVDESIZ_ROTALAR = [
    '/api/is/baslat',
    '/api/is/duraklat',
    '/api/is/devam',
    '/api/is/durdur',
    '/api/is/kullanici-hazir',
    '/api/klasoru-ac',
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

  it('gövdeli POST hâlâ normal ayrıştırılır', async () => {
    const yanit = await uygulama.inject({
      method: 'POST',
      url: '/api/proje/onizleme',
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
      url: '/api/proje/onizleme',
      headers: tarayiciBasliklari(),
      payload: '{ bozuk json',
    });
    expect(yanit.statusCode).toBe(400);
  });

  it('PUT /api/proje boş gövdeyle 400 döner (gerçekten gövde gerekiyor)', async () => {
    const yanit = await uygulama.inject({
      method: 'PUT',
      url: '/api/proje',
      headers: tarayiciBasliklari(),
    });
    // Boş gövde geçerli proje değil; doğrulama hatası beklenir, ayrıştırma çökmesi değil
    expect(yanit.statusCode).toBe(400);
    expect(yanit.json().hata).toBeTruthy();
  });
});
