import { describe, expect, it } from 'vitest';
import { extractWaitMinutes, detectRateLimit } from '../src/rateLimit.js';

describe('detectRateLimit', () => {
  it('catches limit messages', () => {
    expect(detectRateLimit("You've reached your image generation limit.").limited).toBe(true);
    expect(detectRateLimit('Too many requests. Please try again later.').limited).toBe(true);
    expect(detectRateLimit('Görsel oluşturma limitin doldu.').limited).toBe(true);
  });

  it('does not count normal messages as a limit', () => {
    expect(detectRateLimit('İşte kedi görselin!').limited).toBe(false);
    expect(detectRateLimit('').limited).toBe(false);
  });

  it('extracts the wait from the message in minutes', () => {
    expect(detectRateLimit('Limit reached. Try again in 25 minutes.').waitMinutes).toBe(25);
    expect(detectRateLimit('Try again in 2 hours.').waitMinutes).toBe(120);
    expect(detectRateLimit('Try again in 1 hour 30 minutes.').waitMinutes).toBe(90);
  });

  it('waitMinutes is undefined when no duration is mentioned', () => {
    expect(detectRateLimit('Too many requests. Please try again later.').waitMinutes).toBeUndefined();
  });
});

describe('extractWaitMinutes', () => {
  it('understands Turkish duration phrases too', () => {
    expect(extractWaitMinutes('45 dakika sonra tekrar dene')).toBe(45);
    expect(extractWaitMinutes('1 saat sonra tekrar dene')).toBe(60);
  });
});
