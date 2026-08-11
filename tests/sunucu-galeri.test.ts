import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjeDepo, varsayilanProje } from '../src/depo/projeDepo.js';
import { IsYoneticisi } from '../src/is/isYoneticisi.js';
import { sunucuOlustur } from '../src/sunucu/index.js';
import { klasorKomutu, urlKomutu } from '../src/sunucu/klasor.js';

const TOKEN = 'test-token';
const ORIGIN = 'http://127.0.0.1:3000';
const yetkili = () => ({ 'x-token': TOKEN, origin: ORIGIN });

// 1x1 saydam PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let kok: string;
let ciktiKlasoru: string;
let acilanYollar: string[];
let uygulama: ReturnType<typeof sunucuOlustur>;

beforeEach(() => {
  kok = mkdtempSync(join(tmpdir(), 'galeri-test-'));
  ciktiKlasoru = join(kok, 'cikti', 'proje');
  mkdirSync(ciktiKlasoru, { recursive: true });
  const web = join(kok, 'web');
  mkdirSync(web, { recursive: true });
  writeFileSync(join(web, 'index.html'), '<h1>x</h1>', 'utf-8');

  writeFileSync(join(ciktiKlasoru, 'kedi_kar.png'), PNG);
  writeFileSync(join(ciktiKlasoru, 'kedi_plaj.png'), PNG);
  writeFileSync(join(ciktiKlasoru, 'notlar.txt'), 'png değil', 'utf-8');
  writeFileSync(join(kok, 'gizli.png'), PNG);

  const depo = new ProjeDepo(kok);
  depo.yaz({ ...varsayilanProje(join(kok, 'cikti')), ciktiKlasoru });

  acilanYollar = [];
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
    klasoruAc: (yol) => acilanYollar.push(yol),
  });
});

afterEach(async () => {
  await uygulama.close();
  rmSync(kok, { recursive: true, force: true });
});

describe('klasorKomutu', () => {
  it('macOS için open -R üretir', () => {
    expect(klasorKomutu('darwin', '/a/b')).toEqual({ komut: 'open', argumanlar: ['-R', '/a/b'] });
  });
  it('Windows için explorer üretir', () => {
    expect(klasorKomutu('win32', 'C:\\a')).toEqual({ komut: 'explorer', argumanlar: ['C:\\a'] });
  });
  it('Linux için xdg-open üretir', () => {
    expect(klasorKomutu('linux', '/a/b')).toEqual({ komut: 'xdg-open', argumanlar: ['/a/b'] });
  });
  it('yolu asla kabuk stringine gömmez (argüman dizisi döner)', () => {
    const { argumanlar } = klasorKomutu('darwin', '/a/b; rm -rf /');
    expect(argumanlar.at(-1)).toBe('/a/b; rm -rf /');
  });
});

describe('urlKomutu', () => {
  it('macOS için open kullanır, -R KULLANMAZ (-R Finder gösterir, tarayıcı açmaz)', () => {
    expect(urlKomutu('darwin', 'http://127.0.0.1:3000/?t=x')).toEqual({
      komut: 'open',
      argumanlar: ['http://127.0.0.1:3000/?t=x'],
    });
  });
  it('Windows için cmd /c start üretir (boş başlık argümanıyla)', () => {
    expect(urlKomutu('win32', 'http://a')).toEqual({
      komut: 'cmd',
      argumanlar: ['/c', 'start', '', 'http://a'],
    });
  });
  it('Linux için xdg-open üretir', () => {
    expect(urlKomutu('linux', 'http://a')).toEqual({ komut: 'xdg-open', argumanlar: ['http://a'] });
  });
});

describe('GET /api/galeri', () => {
  it('yalnızca png dosyalarını sıralı listeler', async () => {
    const y = await uygulama.inject({ method: 'GET', url: '/api/galeri', headers: yetkili() });
    expect(y.statusCode).toBe(200);
    expect(y.json().dosyalar).toEqual(['kedi_kar.png', 'kedi_plaj.png']);
  });

  it('çıktı klasörü yoksa boş liste döner', async () => {
    rmSync(ciktiKlasoru, { recursive: true, force: true });
    const y = await uygulama.inject({ method: 'GET', url: '/api/galeri', headers: yetkili() });
    expect(y.statusCode).toBe(200);
    expect(y.json().dosyalar).toEqual([]);
  });
});

describe('GET /api/gorsel/:ad', () => {
  it('png dosyasını doğru content-type ile servis eder', async () => {
    const y = await uygulama.inject({
      method: 'GET',
      url: '/api/gorsel/kedi_kar.png',
      headers: yetkili(),
    });
    expect(y.statusCode).toBe(200);
    expect(y.headers['content-type']).toContain('image/png');
    expect(y.rawPayload.length).toBe(PNG.length);
  });

  it('olmayan dosya için 404 döner', async () => {
    const y = await uygulama.inject({
      method: 'GET',
      url: '/api/gorsel/yok.png',
      headers: yetkili(),
    });
    expect(y.statusCode).toBe(404);
  });

  it('png olmayan dosyayı reddeder', async () => {
    const y = await uygulama.inject({
      method: 'GET',
      url: '/api/gorsel/notlar.txt',
      headers: yetkili(),
    });
    expect(y.statusCode).toBe(400);
  });

  it('path traversal ile klasör dışına çıkmayı reddeder', async () => {
    const y = await uygulama.inject({
      method: 'GET',
      url: '/api/gorsel/..%2Fgizli.png',
      headers: yetkili(),
    });
    expect([400, 404]).toContain(y.statusCode);
  });

  it('çıktı klasöründeki symlink ile dışarı sızdırmayı reddeder', async () => {
    // Sözdizimsel kontrolü geçen ama gerçekte kök dışını gösteren bağlantı
    symlinkSync(join(kok, 'gizli.png'), join(ciktiKlasoru, 'tuzak.png'));
    const y = await uygulama.inject({
      method: 'GET',
      url: '/api/gorsel/tuzak.png',
      headers: yetkili(),
    });
    expect(y.statusCode).toBe(404);
  });
});

describe('POST /api/klasoru-ac', () => {
  it('projenin çıktı klasörünü açar', async () => {
    const y = await uygulama.inject({
      method: 'POST',
      url: '/api/klasoru-ac',
      headers: yetkili(),
    });
    expect(y.statusCode).toBe(200);
    expect(acilanYollar).toEqual([ciktiKlasoru]);
  });
});
