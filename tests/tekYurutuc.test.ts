import { describe, expect, it } from 'vitest';
import { TekYurutuc } from '../src/is/tekYurutuc.js';

/** Elle çözülebilen promise — zamanlamayı testin kontrolüne verir. */
function ertelenmis() {
  let coz!: () => void;
  let reddet!: (hata: Error) => void;
  const promise = new Promise<void>((c, r) => {
    coz = c;
    reddet = r;
  });
  return { promise, coz, reddet };
}

describe('TekYurutuc', () => {
  it('aynı anda gelen iki çağrı işi yalnızca bir kez çalıştırır', async () => {
    const yurutuc = new TekYurutuc();
    const kapi = ertelenmis();
    let sayac = 0;
    const is = () => {
      sayac++;
      return kapi.promise;
    };

    const birinci = yurutuc.yurut(is);
    const ikinci = yurutuc.yurut(is);

    expect(sayac).toBe(1);
    kapi.coz();
    await Promise.all([birinci, ikinci]);
    expect(sayac).toBe(1);
  });

  it('ikinci çağrı sürenin bitişini bekler', async () => {
    const yurutuc = new TekYurutuc();
    const kapi = ertelenmis();
    let ikinciBitti = false;

    const birinci = yurutuc.yurut(() => kapi.promise);
    const ikinci = yurutuc.yurut(() => kapi.promise).then(() => {
      ikinciBitti = true;
    });

    await Promise.resolve();
    expect(ikinciBitti).toBe(false);

    kapi.coz();
    await Promise.all([birinci, ikinci]);
    expect(ikinciBitti).toBe(true);
  });

  it('süren bittikten sonra gelen çağrı işi yeniden çalıştırır', async () => {
    const yurutuc = new TekYurutuc();
    let sayac = 0;
    const is = async () => {
      sayac++;
    };

    await yurutuc.yurut(is);
    await yurutuc.yurut(is);
    expect(sayac).toBe(2);
  });

  it('iş fırlatırsa iki çağrı da hatayı görür, sonraki çağrı yeniden çalıştırır', async () => {
    const yurutuc = new TekYurutuc();
    const kapi = ertelenmis();
    let sayac = 0;
    const is = () => {
      sayac++;
      return kapi.promise;
    };

    const birinci = yurutuc.yurut(is);
    const ikinci = yurutuc.yurut(is);
    kapi.reddet(new Error('patladı'));

    await expect(birinci).rejects.toThrow('patladı');
    await expect(ikinci).rejects.toThrow('patladı');

    await yurutuc.yurut(async () => {
      sayac++;
    });
    expect(sayac).toBe(2);
  });
});
