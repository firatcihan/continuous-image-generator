import { describe, expect, it } from 'vitest';
import { Kapi } from '../src/is/kapi.js';

describe('Kapi', () => {
  it('varsayılan olarak açıktır ve gec() hemen döner', async () => {
    const kapi = new Kapi();
    expect(kapi.acik()).toBe(true);
    await kapi.gec();
  });

  it('kapalıyken bekletir, ac() ile serbest bırakır', async () => {
    const kapi = new Kapi();
    kapi.kapat();
    expect(kapi.acik()).toBe(false);

    let gecti = false;
    const bekleyen = kapi.gec().then(() => {
      gecti = true;
    });

    await Promise.resolve();
    expect(gecti).toBe(false);

    kapi.ac();
    await bekleyen;
    expect(gecti).toBe(true);
  });

  it('birden fazla bekleyeni tek ac() ile serbest bırakır', async () => {
    const kapi = new Kapi();
    kapi.kapat();
    const bekleyenler = [kapi.gec(), kapi.gec(), kapi.gec()];
    kapi.ac();
    await Promise.all(bekleyenler);
    expect(kapi.acik()).toBe(true);
  });

  it('zaten açıkken ac() çağrısı sorun çıkarmaz', () => {
    const kapi = new Kapi();
    kapi.ac();
    expect(kapi.acik()).toBe(true);
  });
});
