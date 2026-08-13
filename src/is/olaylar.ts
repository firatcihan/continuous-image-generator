import type { IslemOzeti } from '../tipler.js';

export type IsDurumu =
  | 'bosta'
  | 'calisiyor'
  | 'duraklatildi'
  | 'limitBekliyor'
  | 'kullaniciBekliyor'
  | 'bitti'
  | 'durduruldu'
  | 'hata';

export type IsOlayi =
  | { tip: 'durum'; durum: IsDurumu; projeId: string | null; ozet: IslemOzeti }
  | { tip: 'satirBasladi'; sira: number; toplam: number; dosyaAdi: string }
  | { tip: 'gorselHazir'; dosyaAdi: string }
  | {
      tip: 'satirBitti';
      sira: number;
      /** UI'ın "üretiliyor" listesinden satırı çıkarabilmesi için. */
      dosyaAdi: string;
      sonuc: 'basarili' | 'atlandi' | 'basarisiz';
      /** Sayaçlar koşu boyunca canlı kalsın diye her satırda güncel özet. */
      ozet: IslemOzeti;
      sebep?: string;
    }
  | { tip: 'limitBekleniyor'; kalanSn: number }
  /** ChatGPT geçici hata verdi; kısa beklemeden sonra tekrar denenecek. */
  | { tip: 'geciciHata' }
  | { tip: 'kullaniciGerekli'; mesaj: string }
  | { tip: 'hata'; mesaj: string }
  | { tip: 'bitti'; ozet: IslemOzeti };
