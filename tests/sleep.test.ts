import { describe, expect, it } from 'vitest';
import { Gate } from '../src/job/gate.js';
import { interruptibleSleep } from '../src/job/sleep.js';

/** Fake sleep that never really waits; records the requested durations. */
function fakeSleep() {
  const calls: number[] = [];
  return {
    calls,
    sleep: async (ms: number) => {
      calls.push(ms);
    },
  };
}

describe('interruptibleSleep', () => {
  it('splits the duration into stepMs slices', async () => {
    const f = fakeSleep();
    await interruptibleSleep(3000, { stepMs: 1000, sleep: f.sleep });
    expect(f.calls).toEqual([1000, 1000, 1000]);
  });

  it('the last slice is only the remaining duration', async () => {
    const f = fakeSleep();
    await interruptibleSleep(2500, { stepMs: 1000, sleep: f.sleep });
    expect(f.calls).toEqual([1000, 1000, 500]);
  });

  it('calls tick at the start of every slice with the remaining time', async () => {
    const f = fakeSleep();
    const remaining: number[] = [];
    await interruptibleSleep(3000, { stepMs: 1000, sleep: f.sleep, tick: (r) => remaining.push(r) });
    expect(remaining).toEqual([3000, 2000, 1000]);
  });

  it('returns early when the signal aborts', async () => {
    const f = fakeSleep();
    const controller = new AbortController();
    let tickCount = 0;
    await interruptibleSleep(60_000, {
      stepMs: 1000,
      sleep: f.sleep,
      signal: controller.signal,
      tick: () => {
        tickCount++;
        if (tickCount === 2) controller.abort();
      },
    });
    expect(f.calls.length).toBeLessThan(5);
  });

  it('never sleeps when already aborted at the start', async () => {
    const f = fakeSleep();
    const controller = new AbortController();
    controller.abort();
    await interruptibleSleep(5000, { stepMs: 1000, sleep: f.sleep, signal: controller.signal });
    expect(f.calls).toEqual([]);
  });

  it('waits while the gate is closed, continues once opened', async () => {
    const f = fakeSleep();
    const gate = new Gate();
    gate.close();

    let finished = false;
    const run = interruptibleSleep(1000, { stepMs: 1000, sleep: f.sleep, gate }).then(() => {
      finished = true;
    });

    await Promise.resolve();
    expect(finished).toBe(false);

    gate.open();
    await run;
    expect(finished).toBe(true);
  });

  it('returns immediately on zero or negative duration', async () => {
    const f = fakeSleep();
    await interruptibleSleep(0, { stepMs: 1000, sleep: f.sleep });
    expect(f.calls).toEqual([]);
  });

  it(
    'progresses without an infinite loop when stepMs is zero (FINDING 5)',
    async () => {
      const f = fakeSleep();
      await interruptibleSleep(3, { stepMs: 0, sleep: f.sleep });
      expect(f.calls.length).toBeGreaterThan(0);
      expect(f.calls.reduce((a, b) => a + b, 0)).toBe(3);
    },
    1000,
  );

  it(
    'progresses without an infinite loop when stepMs is negative (FINDING 5)',
    async () => {
      const f = fakeSleep();
      await interruptibleSleep(3, { stepMs: -10, sleep: f.sleep });
      expect(f.calls.length).toBeGreaterThan(0);
      expect(f.calls.reduce((a, b) => a + b, 0)).toBe(3);
    },
    1000,
  );
});
