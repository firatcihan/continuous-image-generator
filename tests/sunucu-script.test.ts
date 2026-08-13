import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  kok = mkdtempSync(join(tmpdir(), 'sunucu-script-'));
  const web = join(kok, 'web');
  mkdirSync(web, { recursive: true });
  writeFileSync(join(web, 'index.html'), '<h1>merhaba</h1>', 'utf-8');

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

const yetkili = () => ({ 'x-token': TOKEN, origin: ORIGIN });

describe('POST /api/script/ayristir', () => {
  it('script\'i satırlara çevirir', async () => {
    const y = await uygulama.inject({
      method: 'POST', url: '/api/script/ayristir', headers: yetkili(),
      payload: { icerik: '(0:00) ilk (0:09) son' },
    });
    expect(y.statusCode).toBe(200);
    expect(y.json()).toEqual({
      satirlar: [
        { metin: 'ilk', dosyaAdi: '0_09' },
        { metin: 'son', dosyaAdi: '0_09_son' },
      ],
    });
  });

  it('icerik metin değilse 400 döner', async () => {
    const y = await uygulama.inject({
      method: 'POST', url: '/api/script/ayristir', headers: yetkili(),
      payload: { icerik: 42 },
    });
    expect(y.statusCode).toBe(400);
    expect(y.json().hata).toBe('icerik metni gerekli');
  });

  it('damga yoksa ayrıştırıcının mesajıyla 400 döner', async () => {
    const y = await uygulama.inject({
      method: 'POST', url: '/api/script/ayristir', headers: yetkili(),
      payload: { icerik: 'damgasız' },
    });
    expect(y.statusCode).toBe(400);
    expect(y.json().hata).toMatch(/zaman damgası bulunamadı/);
  });

  it('token yoksa 401 döner', async () => {
    const y = await uygulama.inject({
      method: 'POST', url: '/api/script/ayristir',
      payload: { icerik: '(0:00) a (0:09) b' },
    });
    expect(y.statusCode).toBe(401);
  });
});
