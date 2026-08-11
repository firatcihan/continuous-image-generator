/** Duraklatma kapısı. Kapalıyken gec() bekletir, ac() tüm bekleyenleri serbest bırakır. */
export class Kapi {
  private kapali = false;
  private bekleyenler: Array<() => void> = [];

  acik(): boolean {
    return !this.kapali;
  }

  kapat(): void {
    this.kapali = true;
  }

  ac(): void {
    this.kapali = false;
    const cozulecekler = this.bekleyenler;
    this.bekleyenler = [];
    for (const coz of cozulecekler) coz();
  }

  gec(): Promise<void> {
    if (!this.kapali) return Promise.resolve();
    return new Promise((coz) => this.bekleyenler.push(coz));
  }
}
