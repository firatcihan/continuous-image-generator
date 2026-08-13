export interface Config {
  basePrompt: string;
  ciktiKlasoru: string;
  chromeProfil: string;
  /** Boş string ise model kontrolü atlanır. */
  modelAdi: string;
  /** [min, maks] saniye. */
  satirArasiBekleme: [number, number];
  uretimZamanAsimiSn: number;
  tekrarDenemeSayisi: number;
  rateLimitVarsayilanBeklemeDk: number;
  /** Eş zamanlı sekme sayısı, 1-4. 1 = sıralı. */
  esZamanliSekme: number;
}

export interface Satir {
  metin: string;
  dosyaAdi: string;
}

export type GorselSonucu =
  | { tip: 'gorsel' }
  | { tip: 'rateLimit'; mesaj: string }
  | { tip: 'red'; mesaj: string }
  /** ChatGPT'nin geçici/genel hatası ("Bir şeyler ters gitti"). Kısa beklemeyle tekrar denenir. */
  | { tip: 'geciciHata'; mesaj: string }
  | { tip: 'zamanAsimi' };

/** Chromium context'i — bütün sekmeler paylaşır. */
export interface UretimTarayicisi {
  baslat(): Promise<void>;
  yenidenBaslat(): Promise<void>;
  /** Sekme sayısını n'e tamamlar ve hepsinin tutamacını döndürür. */
  sekmeleriHazirla(n: number): Promise<UretimSekmesi[]>;
  kapat(): Promise<void>;
}

/** Tek sekme — tek bir işçiye aittir, paylaşılmaz. */
export interface UretimSekmesi {
  yeniSohbetAc(): Promise<void>;
  oturumAcikMi(): Promise<boolean>;
  aktifModelAdi(): Promise<string>;
  gorselUret(prompt: string, zamanAsimiSn: number): Promise<GorselSonucu>;
  sonGorseliKaydet(hedefYol: string): Promise<void>;
}

export interface IslemOzeti {
  basarili: number;
  atlanan: number;
  basarisiz: number;
}
