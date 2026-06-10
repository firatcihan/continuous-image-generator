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
}

export interface Satir {
  metin: string;
  dosyaAdi: string;
}

export type GorselSonucu =
  | { tip: 'gorsel' }
  | { tip: 'rateLimit'; mesaj: string }
  | { tip: 'red'; mesaj: string }
  | { tip: 'zamanAsimi' };

export interface UretimTarayicisi {
  baslat(): Promise<void>;
  yenidenBaslat(): Promise<void>;
  yeniSohbetAc(): Promise<void>;
  oturumAcikMi(): Promise<boolean>;
  aktifModelAdi(): Promise<string>;
  gorselUret(prompt: string, zamanAsimiSn: number): Promise<GorselSonucu>;
  sonGorseliKaydet(hedefYol: string): Promise<void>;
  kapat(): Promise<void>;
}

export interface IslemOzeti {
  basarili: number;
  atlanan: number;
  basarisiz: number;
}
