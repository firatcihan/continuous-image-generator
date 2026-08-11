import { uyu as gercekUyu } from '../bekleme.js';
import type { Kapi } from './kapi.js';

export interface UykuSecenekleri {
  signal?: AbortSignal;
  kapi?: Kapi;
  /** Her dilim başında kalan süreyle çağrılır. */
  tik?: (kalanMs: number) => void;
  /** Dilim uzunluğu; varsayılan 1 saniye. */
  adimMs?: number;
  /** Test için enjekte edilir; varsayılan gerçek setTimeout. */
  uyu?: (ms: number) => Promise<void>;
}

/**
 * Uykuyu dilimlere böler; iptal edilebilir ve duraklatılabilir.
 * 15 dakikalık rate-limit beklemesinin Durdur'a anında yanıt vermesi için gerekli.
 */
export async function uyuKesintili(ms: number, secenekler: UykuSecenekleri = {}): Promise<void> {
  const { signal, kapi, tik, adimMs: adimMsGirdi = 1000, uyu = gercekUyu } = secenekler;
  // Sıfır veya negatif adimMs, dilim boyutunu sıfır/negatif yapıp `kalan`ı hiç
  // ilerletmeyerek sonsuz döngüye yol açar; güvenli bir alt sınıra zorluyoruz.
  const adimMs = Math.max(1, adimMsGirdi);

  let kalan = ms;
  while (kalan > 0) {
    if (signal?.aborted) return;
    if (kapi) await kapi.gec();
    if (signal?.aborted) return;

    tik?.(kalan);
    const dilim = Math.min(adimMs, kalan);
    await uyu(dilim);
    kalan -= dilim;
  }
}
