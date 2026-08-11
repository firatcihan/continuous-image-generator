import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjeDepo, varsayilanProje } from '../src/depo/projeDepo.js';
import { IsYoneticisi } from '../src/is/isYoneticisi.js';
import { sunucuOlustur } from '../src/sunucu/index.js';

const TOKEN = 'test-token';
const ORIGIN = 'http://127.0.0.1:3000';
const yetkili = () => ({ 'x-token': TOKEN, origin: ORIGIN });

let kok: string;
let uygulama: ReturnType<typeof sunucuOlustur>;
let baslatilanProjeler: string[];
let isYoneticisi: IsYoneticisi;

beforeEach(() => {
  kok = mkdtempSync(join(tmpdir(), 'sunucu-is-'));
  const web = join(kok, 'web');
  mkdirSync(web, { recursive: true });
  writeFileSync(join(web, 'index.html'), '<h1>x</h1>', 'utf-8');

  baslatilanProjeler = [];
  isYoneticisi = new IsYoneticisi();

  const depo = new ProjeDepo(kok);
  depo.yaz({
    ...varsayilanProje(join(kok, 'cikti')),
    satirlar: [{ metin: 'karda', dosyaAdi: 'kedi_kar' }],
  });

  uygulama = sunucuOlustur({
    depo,
    isYoneticisi,
    isBaslat: (proje) => baslatilanProjeler.push(proje.ad),
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

describe('GET /api/is', () => {
  it('mevcut durumu döner', async () => {
    const y = await uygulama.inject({ method: 'GET', url: '/api/is', headers: yetkili() });
    expect(y.statusCode).toBe(200);
    expect(y.json().durum).toBe('bosta');
  });
});

describe('POST /api/is/baslat', () => {
  it('projeyi okur ve isBaslat geri çağrısını tetikler', async () => {
    const y = await uygulama.inject({ method: 'POST', url: '/api/is/baslat', headers: yetkili() });
    expect(y.statusCode).toBe(202);
    expect(baslatilanProjeler).toHaveLength(1);
  });

  it('satır listesi boşsa 400 döner ve iş başlatmaz', async () => {
    new ProjeDepo(kok).yaz({ ...varsayilanProje(join(kok, 'cikti')), satirlar: [] });
    const y = await uygulama.inject({ method: 'POST', url: '/api/is/baslat', headers: yetkili() });
    expect(y.statusCode).toBe(400);
    expect(y.json().hata).toMatch(/satır/i);
    expect(baslatilanProjeler).toHaveLength(0);
  });

  it('base promptta yer tutucu yoksa 400 döner ve iş başlatmaz', async () => {
    new ProjeDepo(kok).yaz({
      ...varsayilanProje(join(kok, 'cikti')),
      basePrompt: 'Bir kedi',
      satirlar: [{ metin: 'karda', dosyaAdi: 'a' }],
    });
    const y = await uygulama.inject({ method: 'POST', url: '/api/is/baslat', headers: yetkili() });
    expect(y.statusCode).toBe(400);
    expect(y.json().hata).toMatch(/VARYASYON/);
    expect(baslatilanProjeler).toHaveLength(0);
  });
});

describe('iş kontrol rotaları', () => {
  it('duraklat, devam, durdur ve kullanici-hazir yöneticiye iletilir', async () => {
    const duraklat = vi.spyOn(isYoneticisi, 'duraklat');
    const devam = vi.spyOn(isYoneticisi, 'devam');
    const durdur = vi.spyOn(isYoneticisi, 'durdur');
    const hazir = vi.spyOn(isYoneticisi, 'kullaniciHazir');

    for (const yol of ['duraklat', 'devam', 'durdur', 'kullanici-hazir']) {
      const y = await uygulama.inject({
        method: 'POST',
        url: `/api/is/${yol}`,
        headers: yetkili(),
      });
      expect(y.statusCode).toBe(200);
    }

    expect(duraklat).toHaveBeenCalledOnce();
    expect(devam).toHaveBeenCalledOnce();
    expect(durdur).toHaveBeenCalledOnce();
    expect(hazir).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
});

describe('GET /api/is/akis (SSE)', () => {
  it('SSE başlıklarıyla yanıt verir ve açılışta mevcut durumu gönderir', async () => {
    const sunucu = await uygulama.listen({ port: 0, host: '127.0.0.1' });
    const yanit = await fetch(`${sunucu}/api/is/akis?t=${TOKEN}`);

    expect(yanit.headers.get('content-type')).toContain('text/event-stream');

    const okuyucu = yanit.body!.getReader();
    const { value } = await okuyucu.read();
    const metin = new TextDecoder().decode(value);
    expect(metin).toContain('data: ');
    expect(JSON.parse(metin.replace(/^data: /, '').trim()).tip).toBe('durum');

    await okuyucu.cancel();
  });

  it('bağlantı kapanınca dinleyiciyi söker', async () => {
    const sunucu = await uygulama.listen({ port: 0, host: '127.0.0.1' });
    const yanit = await fetch(`${sunucu}/api/is/akis?t=${TOKEN}`);
    const okuyucu = yanit.body!.getReader();
    await okuyucu.read();
    await okuyucu.cancel();

    await new Promise((c) => setTimeout(c, 50));
    // dinleyici söküldüyse yayın kimseye gitmez ve hata fırlatmaz
    expect(() => isYoneticisi.durdur()).not.toThrow();
  });
});
