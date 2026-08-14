import { describe, expect, it } from 'vitest';
import { randomDurationMs, sleep } from '../src/wait.js';

describe('randomDurationMs', () => {
  it('returns milliseconds inside the range', () => {
    for (let i = 0; i < 100; i++) {
      const ms = randomDurationMs([5, 15]);
      expect(ms).toBeGreaterThanOrEqual(5000);
      expect(ms).toBeLessThanOrEqual(15000);
    }
  });

  it('returns a fixed value when min === max', () => {
    expect(randomDurationMs([3, 3])).toBe(3000);
  });
});

describe('sleep', () => {
  it('waits for the given duration', async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });
});
