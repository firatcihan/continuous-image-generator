import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjeDepo, varsayilanProje } from '../src/depo/projeDepo.js';
import { IsYoneticisi } from '../src/is/isYoneticisi.js';
import { sunucuOlustur } from '../src/sunucu/index.js';

/**
 * Kullanıcının ChatGPT'ye giriş yapabilmesi için tarayıcı, iş başlatmadan
 * ÖNCE ayrı bir eylemle açılabilmeli. Aksi halde Başlat'a basıldığı anda iş
 * sohbete yazmaya başlar ve giriş yapacak an kalmaz.
 */

const TOKEN = 'test-token';
const ORIGIN = 'http://127.0.0.1:3000';
const yetkili = () => ({ 'x-token': TOKEN, origin: ORIGIN });

let kok: string;
let uygulama: ReturnType<typeof sunucuOlustur>;
let tarayiciAcmaSayisi: number;
let tarayiciAcik: boolean;
let acmaHatasi: Error | null;
let baslatilanIsler: number;

function sunucuKur(): void {
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
    isBaslat: () => {
      baslatilanIsler++;
    },
    tarayiciAc: async () => {
      tarayiciAcmaSayisi++;
      if (acmaHatasi) throw acmaHatasi;
      tarayiciAcik = true;
    },
    tarayiciAcikMi: () => tarayiciAcik,
    token: TOKEN,
    izinliOrigin: () => ORIGIN,
    ciktiKoku: join(kok, 'cikti'),
    webKlasoru: web,
    klasoruAc: () => {},
  });
}

beforeEach(() => {
  kok = mkdtempSync(join(tmpdir(), 'tarayici-test-'));
  tarayiciAcmaSayisi = 0;
  tarayiciAcik = false;
  acmaHatasi = null;
  baslatilanIsler = 0;
  sunucuKur();
});

afterEach(async () => {
  await uygulama.close();
  rmSync(kok, { recursive: true, force: true });
});

describe('GET /api/tarayici', () => {
  it('tarayıcı kapalıyken acik:false döner', async () => {
    const y = await uygulama.inject({ method: 'GET', url: '/api/tarayici', headers: yetkili() });
    expect(y.statusCode).toBe(200);
    expect(y.json().acik).toBe(false);
  });

  it('tarayıcı açıldıktan sonra acik:true döner', async () => {
    await uygulama.inject({ method: 'POST', url: '/api/tarayici/ac', headers: yetkili() });
    const y = await uygulama.inject({ method: 'GET', url: '/api/tarayici', headers: yetkili() });
    expect(y.json().acik).toBe(true);
  });
});

describe('POST /api/tarayici/ac', () => {
  it('tarayıcıyı açar ve İŞ BAŞLATMAZ', async () => {
    const y = await uygulama.inject({ method: 'POST', url: '/api/tarayici/ac', headers: yetkili() });
    expect(y.statusCode).toBe(200);
    expect(y.json().acik).toBe(true);
    expect(tarayiciAcmaSayisi).toBe(1);
    expect(baslatilanIsler).toBe(0);
  });

  it('zaten açıksa tekrar açmaya çalışmaz', async () => {
    await uygulama.inject({ method: 'POST', url: '/api/tarayici/ac', headers: yetkili() });
    await uygulama.inject({ method: 'POST', url: '/api/tarayici/ac', headers: yetkili() });
    expect(tarayiciAcmaSayisi).toBe(1);
  });

  it('açma başarısız olursa 500 ve okunabilir mesaj döner', async () => {
    acmaHatasi = new Error("Executable doesn't exist — yarn playwright install");
    const y = await uygulama.inject({ method: 'POST', url: '/api/tarayici/ac', headers: yetkili() });
    expect(y.statusCode).toBe(500);
    expect(y.json().hata).toContain('playwright install');
  });

  it('gövdesiz POST + content-type json ile de çalışır (tarayıcı davranışı)', async () => {
    const y = await uygulama.inject({
      method: 'POST',
      url: '/api/tarayici/ac',
      headers: { ...yetkili(), 'content-type': 'application/json' },
    });
    expect(y.statusCode).toBe(200);
  });
});

describe('POST /api/is/baslat tarayıcı kapalıyken', () => {
  it('409 döner ve iş başlatmaz — önce giriş yapılmalı', async () => {
    const y = await uygulama.inject({ method: 'POST', url: '/api/is/baslat', headers: yetkili() });
    expect(y.statusCode).toBe(409);
    expect(y.json().hata).toMatch(/tarayıcı/i);
    expect(baslatilanIsler).toBe(0);
  });

  it('tarayıcı açıldıktan sonra iş başlar', async () => {
    await uygulama.inject({ method: 'POST', url: '/api/tarayici/ac', headers: yetkili() });
    const y = await uygulama.inject({ method: 'POST', url: '/api/is/baslat', headers: yetkili() });
    expect(y.statusCode).toBe(202);
    expect(baslatilanIsler).toBe(1);
  });
});
