import { writeFileSync } from 'node:fs';
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';
import { uyu } from './bekleme.js';
import { geciciHataAlgila } from './geciciHata.js';
import { rateLimitAlgila } from './rateLimit.js';
import { CHATGPT_URL, SECICILER } from './seciciler.js';
import type { GorselSonucu, UretimSekmesi, UretimTarayicisi } from './tipler.js';

/** Engel kutusunu kapatan buton — arayüz diline göre "Anladım" ya da "Got it". */
const ENGEL_KUTUSU_BUTONU = /anladım|anladim|got it|tamam/i;

/**
 * ChatGPT'nin "yeni sohbet" kısayolu.
 *
 * Seçici yerine kısayol: ChatGPT'nin kenar çubuğu düzeni ve testid'leri sık
 * değişiyor, kısayol değişmiyor. Tutmazsa zaten tam gezinmeye düşülüyor.
 */
const YENI_SOHBET_KISAYOLU = process.platform === 'darwin' ? 'Meta+Shift+O' : 'Control+Shift+O';

/** Uygulama içi yeni sohbetin açıldığının doğrulanması için üst sınır. */
const YENI_SOHBET_DOGRULAMA_MS = 5_000;

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

  constructor(
    private profilYolu: string,
    /** Sekmelerin kullandığı kayıt kancası; verilmezse sessiz çalışır. */
    readonly bilgiYaz: (mesaj: string) => void = () => {},
  ) {}

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
    // Satır başına TAM SAYFA gezinme, "Çok fazla istek" kutusunu tetikleyen
    // şeyin ta kendisi: her yükleme sohbet geçmişini yeniden çekiyor ve 4 sekme
    // × 30 satır bunu dakikalar içinde onlarca kez yapıyor. Uygulama içi yeni
    // sohbet aynı sonucu geçmişi tazelemeden veriyor.
    if (await this.uygulamaIciYeniSohbet()) return;

    const sayfa = this.sayfa();
    await sayfa.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded' });
    // Kutu en çok burada çıkar. Prompt kutusunu beklemeden önce yoldan çekiliyor.
    await this.engelKutusunuKapat();
    await sayfa.waitForSelector(SECICILER.promptKutusu, { timeout: 30_000 });
  }

  /**
   * Kısayolla yeni sohbet açmayı dener.
   *
   * Başarı ölçütü SEÇİCİ DEĞİL DAVRANIŞ: sohbet gerçekten boşaldı ve prompt
   * kutusu hazır mı? Kısayol bir gün çalışmazsa bu doğrulama tutmaz, `false`
   * döner ve çağıran eski tam gezinme yoluna düşer — sessiz bozulma olmaz.
   */
  private async uygulamaIciYeniSohbet(): Promise<boolean> {
    const sayfa = this.sayfa();
    if (!sayfa.url().startsWith(CHATGPT_URL)) return false; // henüz sitede değiliz

    await this.engelKutusunuKapat();
    const kutu = sayfa.locator(SECICILER.promptKutusu).first();
    if (!(await kutu.isVisible().catch(() => false))) return false;

    await sayfa.keyboard.press(YENI_SOHBET_KISAYOLU).catch(() => {});

    const bitis = Date.now() + YENI_SOHBET_DOGRULAMA_MS;
    for (;;) {
      const bosaldi = (await sayfa.locator(SECICILER.sohbetTuru).count().catch(() => 1)) === 0;
      const hazir = await kutu.isVisible().catch(() => false);
      if (bosaldi && hazir) return true;
      if (Date.now() >= bitis) break;
      await uyu(250);
    }

    this.ana.bilgiYaz('uygulama içi yeni sohbet tutmadı; tam sayfa gezinmeye düşülüyor');
    return false;
  }

  /**
   * "Çok fazla istek" kutusu açıksa "Anladım"a basıp kapatır.
   * Açık değilse hiçbir şey yapmaz. Dönüş: kutu gerçekten kapatıldı mı?
   *
   * Hiçbir adımı hata fırlatmıyor — bu bir kurtarma yolu, kendisi yeni bir
   * başarısızlık kaynağı olmamalı.
   */
  async engelKutusunuKapat(): Promise<boolean> {
    const kutu = this.sayfa().locator(SECICILER.engelKutusu).first();
    if (!(await kutu.isVisible().catch(() => false))) return false;

    const buton = kutu.getByRole('button', { name: ENGEL_KUTUSU_BUTONU }).first();
    await buton.click({ timeout: 5_000 }).catch(() => {});
    const kapandi = await kutu
      .waitFor({ state: 'hidden', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);

    this.ana.bilgiYaz(
      kapandi
        ? '"Çok fazla istek" kutusu kapatıldı; üretime devam ediliyor'
        : '"Çok fazla istek" kutusu kapatılamadı; tıklama engelli kalabilir',
    );
    return kapandi;
  }

  /**
   * Engel kutusu araya girse bile tıklar.
   *
   * Kapatma ile tıklama arasında her zaman bir yarış penceresi var: kutu tam o
   * anda açılabilir. O yüzden tıklama engellenirse kutu bir kez daha kapatılıp
   * tekrar denenir. Ortada kutu yoksa asıl hata olduğu gibi yukarı gider —
   * gerçek arıza yutulmasın.
   */
  private async engelsizTikla(hedef: Locator): Promise<void> {
    await this.engelKutusunuKapat();
    try {
      await hedef.click({ timeout: 15_000 });
    } catch (hata) {
      if (!(await this.engelKutusunuKapat())) throw hata;
      await hedef.click({ timeout: 15_000 });
    }
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
    await this.engelsizTikla(kutu);
    await kutu.fill(prompt);
    await sayfa.keyboard.press('Enter');

    const bitis = Date.now() + zamanAsimiSn * 1000;
    while (Date.now() < bitis) {
      await uyu(2000);

      // Kutu üretim sürerken de açılabiliyor. Bir sonraki satırın tıklamasını
      // beklemeden burada kapatılıyor: 2 sn'lik döngü "sürekli"nin pratikteki
      // karşılığı.
      await this.engelKutusunuKapat();

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
