/**
 * Aynı işi N işçiden yalnızca birine yaptırır; süren varken gelenler ona katılır.
 *
 * Paralel üretimde üç yerde gerekiyor. Bu koruma olmadan 3 işçi: 3 ayrı 15 dk
 * rate-limit uykusuna girip 45 dk'ya serileşir, 3 ayrı "giriş yapın" kartı
 * çıkarır, tarayıcıyı 3 kez yeniden başlatır.
 */
export class TekYurutuc {
  private suren: Promise<void> | null = null;

  yurut(is: () => Promise<void>): Promise<void> {
    if (this.suren !== null) return this.suren;

    // `finally` ile temizlik: süren iş bittikten sonra sorun HÂLÂ duruyorsa
    // bir sonraki işçinin kendi tespiti yeni bir yürütme başlatabilmeli.
    this.suren = is().finally(() => {
      this.suren = null;
    });
    return this.suren;
  }
}
