import { writeFileSync } from 'node:fs';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { uyu } from './bekleme.js';
import { geciciHataAlgila } from './geciciHata.js';
import { rateLimitAlgila } from './rateLimit.js';
import { CHATGPT_URL, SECICILER } from './seciciler.js';
import type { GorselSonucu, UretimSekmesi, UretimTarayicisi } from './tipler.js';

const RED_KALIPLARI = [
  /can('|’)?t (create|generate|help with) (that|this)/i,
  /unable to (create|generate)/i,
  /content polic(y|ies)/i,
  /violates? (our|the) polic/i,
  /bu görseli oluşturam/i,
  /içerik politika/i,
];

export class ChatgptTarayicisi implements UretimTarayicisi {
  private context: BrowserContext | null = null;
  private sayfalar: Page[] = [];
  /** yenidenBaslat() aynı sayıda sekmeyi geri kurabilsin diye saklanır. */
  private sekmeSayisi = 1;

  constructor(private profilYolu: string) {}

  async baslat(): Promise<void> {
    this.context = await chromium.launchPersistentContext(this.profilYolu, {
      headless: false,
      viewport: null,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    const ilk = this.context.pages()[0] ?? (await this.context.newPage());
    await ilk.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded' });
    this.sayfalar = [ilk];
    // Çökme sonrası kurtarmada eski sekme sayısı geri kurulur; ilk açılışta
    // sekmeSayisi 1 olduğu için bu çağrı bir şey yapmaz.
    await this.sayfalariTamamla(this.sekmeSayisi);
  }

  async yenidenBaslat(): Promise<void> {
    await this.kapat().catch(() => {});
    await this.baslat();
  }

  async sekmeleriHazirla(n: number): Promise<UretimSekmesi[]> {
    this.sekmeSayisi = n;
    await this.sayfalariTamamla(n);
    return Array.from({ length: n }, (_, slot) => new ChatgptSekmesi(this, slot));
  }

  async kapat(): Promise<void> {
    await this.context?.close();
    this.context = null;
    this.sayfalar = [];
  }

  /**
   * `ChatgptSekmesi` için: slot'un GÜNCEL sayfası.
   * Yeniden başlatma diziyi tazelediği için sekme tutamaçları geçerli kalır.
   */
  sayfaAl(slot: number): Page {
    const sayfa = this.sayfalar[slot];
    if (!sayfa) {
      throw new Error(`sekme ${slot} hazır değil; önce sekmeleriHazirla() çağrılmalı`);
    }
    return sayfa;
  }

  private async sayfalariTamamla(n: number): Promise<void> {
    const context = this.context;
    if (!context) throw new Error('tarayıcı başlatılmadı; önce baslat() çağrılmalı');

    while (this.sayfalar.length < n) {
      const sayfa = await context.newPage();
      await sayfa.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded' });
      this.sayfalar.push(sayfa);
    }
  }
}

/**
 * Tek sekme tutamacı. Ham `Page` TUTMAZ: `yenidenBaslat()` bütün `Page`
 * nesnelerini öldürüyor; slot dolaylaması sayesinde işçinin elindeki tutamaç
 * çökme sonrasında da geçerli kalır.
 */
export class ChatgptSekmesi implements UretimSekmesi {
  constructor(
    private ana: ChatgptTarayicisi,
    private slot: number,
  ) {}

  async yeniSohbetAc(): Promise<void> {
    const sayfa = this.sayfa();
    await sayfa.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded' });
    await sayfa.waitForSelector(SECICILER.promptKutusu, { timeout: 30_000 });
  }

  async oturumAcikMi(): Promise<boolean> {
    const girisButonu = this.sayfa().getByRole('button', { name: /log ?in|giriş yap/i });
    const girisGorunur = await girisButonu
      .first()
      .isVisible()
      .catch(() => false);
    return !girisGorunur;
  }

  async aktifModelAdi(): Promise<string> {
    const secici = this.sayfa().locator(SECICILER.modelSecici).first();
    const gorunur = await secici.isVisible().catch(() => false);
    if (!gorunur) return '';
    return ((await secici.textContent()) ?? '').trim();
  }

  async gorselUret(prompt: string, zamanAsimiSn: number): Promise<GorselSonucu> {
    const sayfa = this.sayfa();
    const oncekiGorselSayisi = await sayfa.locator(SECICILER.sohbetGorseli).count();

    const kutu = sayfa.locator(SECICILER.promptKutusu);
    await kutu.click();
    await kutu.fill(prompt);
    await sayfa.keyboard.press('Enter');

    const bitis = Date.now() + zamanAsimiSn * 1000;
    while (Date.now() < bitis) {
      await uyu(2000);

      const uyarilar = await sayfa
        .locator(SECICILER.uyariKutusu)
        .allInnerTexts()
        .catch(() => [] as string[]);
      const kontrolMetni = (await this.sonSohbetTuruMetni()) + '\n' + uyarilar.join('\n');

      if (rateLimitAlgila(kontrolMetni).limitli) {
        return { tip: 'rateLimit', mesaj: kontrolMetni };
      }
      if (RED_KALIPLARI.some((kalip) => kalip.test(kontrolMetni))) {
        return { tip: 'red', mesaj: kontrolMetni };
      }
      // Rate limit ve içerik reddinden SONRA bakılır: o ikisinin kendi ele
      // alınma yolu var. Burada yakalanmazsa üretim zaman aşımına kadar
      // (varsayılan 180 sn) boşuna beklenirdi.
      if (geciciHataAlgila(kontrolMetni)) {
        return { tip: 'geciciHata', mesaj: kontrolMetni.slice(0, 300) };
      }

      const uretimSuruyor = await sayfa
        .locator(SECICILER.durdurButonu)
        .isVisible()
        .catch(() => false);
      const gorselSayisi = await sayfa.locator(SECICILER.sohbetGorseli).count();
      if (!uretimSuruyor && gorselSayisi > oncekiGorselSayisi) {
        await uyu(2000); // görselin tam çözünürlükte yüklenmesi için kısa pay
        return { tip: 'gorsel' };
      }
    }
    return { tip: 'zamanAsimi' };
  }

  async sonGorseliKaydet(hedefYol: string): Promise<void> {
    const sayfa = this.sayfa();
    const gorsel = sayfa.locator(SECICILER.sohbetGorseli).last();
    const src = await gorsel.getAttribute('src');
    if (!src) throw new Error('görsel src özniteliği bulunamadı');

    let veri: Buffer;
    if (src.startsWith('blob:') || src.startsWith('data:')) {
      const base64 = await sayfa.evaluate(async (url) => {
        const yanit = await fetch(url);
        const blob = await yanit.blob();
        return await new Promise<string>((coz) => {
          const okuyucu = new FileReader();
          okuyucu.onloadend = () => coz((okuyucu.result as string).split(',')[1]);
          okuyucu.readAsDataURL(blob);
        });
      }, src);
      veri = Buffer.from(base64, 'base64');
    } else {
      const yanit = await sayfa.request.get(src);
      if (!yanit.ok()) throw new Error(`görsel indirilemedi: HTTP ${yanit.status()}`);
      veri = Buffer.from(await yanit.body());
    }
    writeFileSync(hedefYol, veri);
  }

  private sayfa(): Page {
    return this.ana.sayfaAl(this.slot);
  }

  private async sonSohbetTuruMetni(): Promise<string> {
    const turlar = this.sayfa().locator(SECICILER.sohbetTuru);
    const sayi = await turlar.count();
    if (sayi === 0) return '';
    return (await turlar.last().innerText().catch(() => '')) ?? '';
  }
}
