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
  | { tip: 'satirBitti'; sira: number; sonuc: 'basarili' | 'atlandi' | 'basarisiz'; sebep?: string }
  | { tip: 'limitBekleniyor'; kalanSn: number }
  /** ChatGPT geçici hata verdi; kısa beklemeden sonra tekrar denenecek. */
  | { tip: 'geciciHata' }
  | { tip: 'kullaniciGerekli'; mesaj: string }
  | { tip: 'hata'; mesaj: string }
  | { tip: 'bitti'; ozet: IslemOzeti };
