import { appendFileSync } from 'node:fs';

export class Logger {
  constructor(private filePath: string) {}

  // Level tags stay Turkish: they are part of the calisma.log format users read.
  info(message: string): void {
    this.write('BILGI', message);
  }

  warn(message: string): void {
    this.write('UYARI', message);
  }

  error(message: string): void {
    this.write('HATA', message);
  }

  private write(level: string, message: string): void {
    const line = `[${new Date().toISOString()}] ${level} ${message}`;
    console.log(line);
    appendFileSync(this.filePath, line + '\n', 'utf-8');
  }
}
