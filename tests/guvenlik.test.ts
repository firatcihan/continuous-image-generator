import { describe, expect, it } from 'vitest';
import { cookieTokenOku, istekYetkili, tokenUret } from '../src/sunucu/guvenlik.js';

const BEKLENEN = { token: 'gizli123', izinliOrigin: 'http://127.0.0.1:3000' };

describe('istekYetkili', () => {
  it('doğru token ve izinli origin ile kabul eder', () => {
    expect(istekYetkili({ token: 'gizli123', origin: 'http://127.0.0.1:3000' }, BEKLENEN)).toBe(true);
  });

  it('Origin başlığı yoksa kabul eder', () => {
    expect(istekYetkili({ token: 'gizli123' }, BEKLENEN)).toBe(true);
  });

  it('token yanlışsa reddeder', () => {
    expect(istekYetkili({ token: 'yanlis' }, BEKLENEN)).toBe(false);
  });

  it('token yoksa reddeder', () => {
    expect(istekYetkili({}, BEKLENEN)).toBe(false);
  });

  it('yabancı origin ile reddeder (kötü niyetli site localhost.a istek atarsa)', () => {
    expect(istekYetkili({ token: 'gizli123', origin: 'https://kotu-site.com' }, BEKLENEN)).toBe(false);
  });

  it('farklı portlu localhost origin ile reddeder', () => {
    expect(istekYetkili({ token: 'gizli123', origin: 'http://127.0.0.1:9999' }, BEKLENEN)).toBe(false);
  });
});

describe('tokenUret', () => {
  it('yeterince uzun ve her seferinde farklı token üretir', () => {
    const a = tokenUret();
    const b = tokenUret();
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toBe(b);
  });

  it('URL güvenli karakterler üretir', () => {
    expect(tokenUret()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('cookieTokenOku', () => {
  it('t çerezini okur', () => {
    expect(cookieTokenOku('t=abc123')).toBe('abc123');
  });

  it('birden fazla çerez arasından t\'yi bulur', () => {
    expect(cookieTokenOku('digeri=1; t=abc123; baska=2')).toBe('abc123');
  });

  it('base64url değerindeki eşittir işaretlerini korur', () => {
    expect(cookieTokenOku('t=a=b=c')).toBe('a=b=c');
  });

  it('başlık yoksa veya t yoksa undefined döner', () => {
    expect(cookieTokenOku(undefined)).toBeUndefined();
    expect(cookieTokenOku('digeri=1')).toBeUndefined();
  });

  it('adı t ile başlayan başka çerezi t sanmaz', () => {
    expect(cookieTokenOku('token=yanlis')).toBeUndefined();
  });
});
