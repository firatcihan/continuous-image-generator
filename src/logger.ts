import { appendFileSync } from 'node:fs';

export class Logger {
  constructor(private dosyaYolu: string) {}

  bilgi(mesaj: string): void {
    this.yaz('BILGI', mesaj);
  }

  uyari(mesaj: string): void {
    this.yaz('UYARI', mesaj);
  }

  hata(mesaj: string): void {
    this.yaz('HATA', mesaj);
  }

  private yaz(seviye: string, mesaj: string): void {
    const satir = `[${new Date().toISOString()}] ${seviye} ${mesaj}`;
    console.log(satir);
    appendFileSync(this.dosyaYolu, satir + '\n', 'utf-8');
  }
}
