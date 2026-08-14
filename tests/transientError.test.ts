import { describe, expect, it } from 'vitest';
import { detectTransientError } from '../src/transientError.js';

describe('detectTransientError', () => {
  it('catches ChatGPT\'s Turkish generic error message', () => {
    expect(detectTransientError('Bir şeyler ters gitti. Lütfen tekrar deneyin.')).toBe(true);
  });

  it('catches the English counterpart', () => {
    expect(detectTransientError('Something went wrong. Please try again.')).toBe(true);
  });

  it('catches the other error variants', () => {
    expect(detectTransientError('An error occurred while generating')).toBe(true);
    expect(detectTransientError('Bir hata oluştu')).toBe(true);
    expect(detectTransientError('Görsel oluşturulamadı, yeniden deneyin')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(detectTransientError('BİR ŞEYLER TERS GİTTİ')).toBe(true);
    expect(detectTransientError('SOMETHING WENT WRONG')).toBe(true);
  });

  it('produces no false positives on normal text', () => {
    expect(detectTransientError('İşte istediğiniz görsel')).toBe(false);
    expect(detectTransientError('Here is your image')).toBe(false);
    expect(detectTransientError('')).toBe(false);
  });

  it('does not count a rate limit message as transient (handled separately)', () => {
    expect(detectTransientError("You've reached your image generation limit")).toBe(false);
    expect(detectTransientError('Try again in 25 minutes.')).toBe(false);
  });

  it('does not count a content refusal message as transient', () => {
    expect(detectTransientError("I can't create that image — content policy")).toBe(false);
  });
});
