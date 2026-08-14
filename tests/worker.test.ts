import { describe, expect, it, vi } from 'vitest';
import { Gate, type JobGates } from '../src/job/gate.js';
import type { Config, ImageResult, Row, GenerationTab } from '../src/types.js';
import { processAllRows, type SleepReason, type WorkerDeps } from '../src/worker.js';

const CONFIG: Config = {
  basePrompt: 'Bir kedi, {VARYASYON}',
  ciktiKlasoru: '/tmp/cikti',
  chromeProfil: '/tmp/profil',
  modelAdi: '',
  satirArasiBekleme: [0, 0],
  uretimZamanAsimiSn: 1,
  tekrarDenemeSayisi: 3,
  rateLimitVarsayilanBeklemeDk: 15,
  esZamanliSekme: 1,
};

interface FakeOptions {
  results?: ImageResult[];
  session?: boolean[];
  model?: string;
}

function fakeTabs(opts: FakeOptions = {}, count = 1) {
  // The arrays are SHARED across tabs: tests can script the result order to
  // decide which tab receives what.
  const results = [...(opts.results ?? [])];
  const sessions = [...(opts.session ?? [])];
  const calls: string[] = [];
  const restart = async () => {
    calls.push('restart');
  };

  const tabs: GenerationTab[] = Array.from({ length: count }, () => ({
    openNewChat: async () => {
      calls.push('newChat');
    },
    isLoggedIn: async () => (sessions.length > 0 ? sessions.shift()! : true),
    activeModelName: async () => opts.model ?? 'GPT-5',
    generateImage: async () => {
      calls.push('generate');
      return results.shift() ?? { type: 'image' };
    },
    saveLastImage: async (path: string) => {
      calls.push(`save:${path}`);
    },
  }));

  return { tabs, calls, restart };
}

function deps(
  tabs: GenerationTab[],
  restartBrowser: () => Promise<void>,
  extra: Partial<WorkerDeps> = {},
): WorkerDeps & {
  failures: string[];
  sleeps: Array<{ ms: number; reason: SleepReason }>;
  confirmations: string[];
  events: string[];
  controller: AbortController;
} {
  const failures: string[] = [];
  const sleeps: Array<{ ms: number; reason: SleepReason }> = [];
  const confirmations: string[] = [];
  const events: string[] = [];
  const controller = new AbortController();
  return {
    config: CONFIG,
    tabs,
    restartBrowser,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    control: { signal: controller.signal, gate: new Gate() },
    gates: { limit: new Gate(), user: new Gate(), restart: new Gate() },
    sleep: async (ms: number, reason: SleepReason) => {
      sleeps.push({ ms, reason });
    },
    isCompleted: () => false,
    recordFailure: (row: Row, reason: string) => {
      failures.push(`${row.dosyaAdi}: ${reason}`);
    },
    waitForUser: async (message: string) => {
      confirmations.push(message);
    },
    onRowStarted: (row, _total, record) => events.push(`started:${row}:${record.dosyaAdi}`),
    onRowFinished: (row, result) => events.push(`finished:${row}:${result}`),
    failures,
    sleeps,
    confirmations,
    events,
    controller,
    ...extra,
  };
}

const ROW: Row = { metin: 'karda', dosyaAdi: 'kedi_kar' };

describe('processAllRows', () => {
  it('saves the image to the correct path on a successful generation', async () => {
    const { tabs, calls, restart } = fakeTabs({ results: [{ type: 'image' }] });
    const d = deps(tabs, restart);
    const summary = await processAllRows(d, [ROW]);
    expect(summary).toEqual({ succeeded: 1, skipped: 0, failed: 0 });
    expect(calls).toContain('save:/tmp/cikti/kedi_kar.png');
  });

  it('skips a row whose output already exists', async () => {
    const { tabs, calls, restart } = fakeTabs();
    const d = deps(tabs, restart, { isCompleted: () => true });
    const summary = await processAllRows(d, [ROW]);
    expect(summary).toEqual({ succeeded: 0, skipped: 1, failed: 0 });
    expect(calls).not.toContain('generate');
  });

  it('on a rate limit sleeps as long as the message says and retries the same row', async () => {
    const { tabs, restart } = fakeTabs({
      results: [{ type: 'rateLimit', message: 'Try again in 25 minutes.' }, { type: 'image' }],
    });
    const d = deps(tabs, restart);
    const summary = await processAllRows(d, [ROW]);
    expect(summary.succeeded).toBe(1);
    expect(d.sleeps).toContainEqual({ ms: 25 * 60_000, reason: 'rateLimit' });
  });

  it('sleeps the default duration on a rate limit without a stated time', async () => {
    const { tabs, restart } = fakeTabs({
      results: [{ type: 'rateLimit', message: 'Too many requests. Please try again later.' }, { type: 'image' }],
    });
    const d = deps(tabs, restart);
    await processAllRows(d, [ROW]);
    expect(d.sleeps).toContainEqual({ ms: 15 * 60_000, reason: 'rateLimit' });
  });

  it('records a failure once timeouts exceed the retry count', async () => {
    const { tabs, calls, restart } = fakeTabs({
      results: [{ type: 'timeout' }, { type: 'timeout' }, { type: 'timeout' }],
    });
    const d = deps(tabs, restart);
    const summary = await processAllRows(d, [ROW]);
    expect(summary.failed).toBe(1);
    expect(calls.filter((c) => c === 'generate')).toHaveLength(3);
    expect(d.failures[0]).toContain('kedi_kar');
  });

  it('on a content refusal records a failure without retrying and moves on', async () => {
    const { tabs, calls, restart } = fakeTabs({
      results: [{ type: 'refusal', message: 'content policy' }, { type: 'image' }],
    });
    const d = deps(tabs, restart);
    const summary = await processAllRows(d, [ROW, { metin: 'plajda', dosyaAdi: 'plaj' }]);
    expect(summary).toEqual({ succeeded: 1, skipped: 0, failed: 1 });
    expect(d.failures[0]).toContain('içerik reddi');
    expect(calls.filter((c) => c === 'generate')).toHaveLength(2);
  });

  it('waits for the user when the session drops, burns no retry attempt', async () => {
    const { tabs, restart } = fakeTabs({ session: [false, true], results: [{ type: 'image' }] });
    const d = deps(tabs, restart);
    const summary = await processAllRows(d, [ROW]);
    expect(summary.succeeded).toBe(1);
    expect(d.confirmations).toHaveLength(1);
  });

  it('waits for the user when the wrong model is selected', async () => {
    const { tabs, restart } = fakeTabs({ model: 'GPT-4o mini' });
    let modelFixed = false;
    const d = deps(tabs, restart, {
      config: { ...CONFIG, modelAdi: 'GPT-5' },
      waitForUser: async () => {
        modelFixed = true;
        (tabs[0] as { activeModelName: () => Promise<string> }).activeModelName = async () => 'GPT-5';
      },
    });
    const summary = await processAllRows(d, [ROW]);
    expect(modelFixed).toBe(true);
    expect(summary.succeeded).toBe(1);
  });

  it('restarts and retries on a browser error', async () => {
    const { tabs, calls, restart } = fakeTabs({ results: [{ type: 'image' }] });
    let firstCall = true;
    const originalNewChat = tabs[0].openNewChat;
    tabs[0].openNewChat = async () => {
      if (firstCall) {
        firstCall = false;
        throw new Error('tarayıcı çöktü');
      }
      await originalNewChat();
    };
    const d = deps(tabs, restart);
    const summary = await processAllRows(d, [ROW]);
    expect(summary.succeeded).toBe(1);
    expect(calls).toContain('restart');
  });

  it('a tab failing while another worker restarts burns no retry attempt', async () => {
    const { tabs, calls, restart } = fakeTabs({ results: [{ type: 'image' }] });
    const gates: JobGates = {
      limit: new Gate(),
      user: new Gate(),
      restart: new Gate(),
    };

    // Real scenario: another worker started restarting the browser and the
    // context was pulled out from under this one. Not this row's fault.
    let firstCall = true;
    const originalNewChat = tabs[0].openNewChat;
    tabs[0].openNewChat = async () => {
      if (firstCall) {
        firstCall = false;
        gates.restart.close();
        setTimeout(() => gates.restart.open(), 5);
        throw new Error('sekme 0 hazır değil; önce prepareTabs() çağrılmalı');
      }
      await originalNewChat();
    };

    const d = deps(tabs, restart, { gates, config: { ...CONFIG, tekrarDenemeSayisi: 1 } });
    const summary = await processAllRows(d, [ROW]);

    // tekrarDenemeSayisi=1: had the attempt been burned, the row would fail in one try.
    expect(summary).toEqual({ succeeded: 1, skipped: 0, failed: 0 });
    // A second restart must not be triggered either — waiting it out is enough.
    expect(calls).not.toContain('restart');
  });

  it('processes no remaining rows once stopped', async () => {
    const { tabs, calls, restart } = fakeTabs();
    const d = deps(tabs, restart);
    d.controller.abort();
    const summary = await processAllRows(d, [ROW, { metin: 'plajda', dosyaAdi: 'plaj' }]);
    expect(summary).toEqual({ succeeded: 0, skipped: 0, failed: 0 });
    expect(calls).not.toContain('generate');
  });

  it('does not process the second row when stopped after the first', async () => {
    const { tabs, calls, restart } = fakeTabs({ results: [{ type: 'image' }] });
    const d = deps(tabs, restart, {
      onRowFinished: () => {},
    });
    const originalSleep = d.sleep;
    d.sleep = async (ms, reason) => {
      d.controller.abort();
      await originalSleep(ms, reason);
    };
    const summary = await processAllRows(d, [ROW, { metin: 'plajda', dosyaAdi: 'plaj' }]);
    expect(summary.succeeded).toBe(1);
    expect(calls.filter((c) => c === 'generate')).toHaveLength(1);
  });

  it('starts no row while paused, continues on resume', async () => {
    const { tabs, calls, restart } = fakeTabs({ results: [{ type: 'image' }] });
    const gate = new Gate();
    const controller = new AbortController();
    const d = deps(tabs, restart, { control: { signal: controller.signal, gate } });
    gate.close();

    let finished = false;
    const run = processAllRows(d, [ROW]).then(() => {
      finished = true;
    });

    await Promise.resolve();
    expect(calls).not.toContain('generate');
    expect(finished).toBe(false);

    gate.open();
    await run;
    expect(calls).toContain('generate');
  });

  it('emits the row started and finished events in order', async () => {
    const { tabs, restart } = fakeTabs({ results: [{ type: 'image' }] });
    const d = deps(tabs, restart);
    await processAllRows(d, [ROW]);
    expect(d.events).toEqual(['started:1:kedi_kar', 'finished:1:succeeded']);
  });

  it('emits a skipped event for a skipped row', async () => {
    const { tabs, restart } = fakeTabs();
    const d = deps(tabs, restart, { isCompleted: () => true });
    await processAllRows(d, [ROW]);
    expect(d.events).toEqual(['finished:1:skipped']);
  });

  it('does the between-rows wait with the betweenRows reason', async () => {
    const { tabs, restart } = fakeTabs({ results: [{ type: 'image' }] });
    const d = deps(tabs, restart, { config: { ...CONFIG, satirArasiBekleme: [2, 2] } });
    await processAllRows(d, [ROW]);
    expect(d.sleeps).toContainEqual({ ms: 2000, reason: 'betweenRows' });
  });
  it('on a transient error waits briefly, retries and eventually succeeds', async () => {
    const { tabs, calls, restart } = fakeTabs({
      results: [{ type: 'transientError', message: 'Bir şeyler ters gitti.' }, { type: 'image' }],
    });
    const d = deps(tabs, restart);
    const summary = await processAllRows(d, [ROW]);
    expect(summary.succeeded).toBe(1);
    expect(calls.filter((c) => c === 'generate')).toHaveLength(2);
    expect(d.sleeps.some((x) => x.reason === 'transientError')).toBe(true);
  });

  it('a transient error burns a retry attempt; persistent ones record a failure', async () => {
    const { tabs, calls, restart } = fakeTabs({
      results: [
        { type: 'transientError', message: 'Bir şeyler ters gitti.' },
        { type: 'transientError', message: 'Bir şeyler ters gitti.' },
        { type: 'transientError', message: 'Bir şeyler ters gitti.' },
      ],
    });
    const d = deps(tabs, restart);
    const summary = await processAllRows(d, [ROW]);
    expect(summary.failed).toBe(1);
    expect(calls.filter((c) => c === 'generate')).toHaveLength(3);
    expect(d.failures[0]).toContain('geçici hata');
  });

  it('never waits as long as a rate-limit sleep on a transient error', async () => {
    const { tabs, restart } = fakeTabs({
      results: [{ type: 'transientError', message: 'Bir şeyler ters gitti.' }, { type: 'image' }],
    });
    const d = deps(tabs, restart);
    await processAllRows(d, [ROW]);
    const transientSleep = d.sleeps.find((x) => x.reason === 'transientError');
    expect(transientSleep!.ms).toBeLessThan(60_000);
  });

  it('with N=3, three rows are in flight AT THE SAME TIME', async () => {
    // The core parallelism claim: none finishes before all three tabs started generating.
    let inFlight = 0;
    let peakInFlight = 0;
    const release: Array<() => void> = [];

    const tabs: GenerationTab[] = Array.from({ length: 3 }, () => ({
      openNewChat: async () => {},
      isLoggedIn: async () => true,
      activeModelName: async () => 'GPT-5',
      generateImage: async () => {
        inFlight++;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise<void>((resolve) => release.push(resolve));
        inFlight--;
        return { type: 'image' } as const;
      },
      saveLastImage: async () => {},
    }));

    const d = deps(tabs, async () => {});
    const run = processAllRows(d, [
      ROW,
      { metin: 'plajda', dosyaAdi: 'plaj' },
      { metin: 'dağda', dosyaAdi: 'dag' },
    ]);

    // Wait for all three tabs to enter generateImage
    while (release.length < 3) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(peakInFlight).toBe(3);

    for (const resolve of release) resolve();
    await run;
  });

  it('with N=3, each of 7 rows is processed exactly once', async () => {
    const { tabs, calls, restart } = fakeTabs({}, 3);
    const d = deps(tabs, restart);
    const rows: Row[] = Array.from({ length: 7 }, (_, i) => ({
      metin: `varyasyon ${i}`,
      dosyaAdi: `dosya_${i}`,
    }));

    const summary = await processAllRows(d, rows);

    expect(summary).toEqual({ succeeded: 7, skipped: 0, failed: 0 });
    expect(calls.filter((c) => c === 'generate')).toHaveLength(7);
    const saved = calls.filter((c) => c.startsWith('save:'));
    expect(new Set(saved).size).toBe(7);
  });

  it('with N=3, emits exactly one started and one finished event per row', async () => {
    const { tabs, restart } = fakeTabs({}, 3);
    const d = deps(tabs, restart);
    const rows: Row[] = Array.from({ length: 6 }, (_, i) => ({
      metin: `varyasyon ${i}`,
      dosyaAdi: `dosya_${i}`,
    }));

    await processAllRows(d, rows);

    for (let row = 1; row <= 6; row++) {
      expect(d.events.filter((e) => e.startsWith(`started:${row}:`))).toHaveLength(1);
      expect(d.events.filter((e) => e.startsWith(`finished:${row}:`))).toHaveLength(1);
    }
  });

  it('extra workers retire idle when there are fewer rows than tabs', async () => {
    const { tabs, calls, restart } = fakeTabs({}, 4);
    const d = deps(tabs, restart);

    const summary = await processAllRows(d, [ROW]);

    expect(summary.succeeded).toBe(1);
    expect(calls.filter((c) => c === 'generate')).toHaveLength(1);
  });

  it('worker i does an i × between-rows startup sleep before its first row', async () => {
    // min = max: keeps randomDurationMs deterministic
    const { tabs, restart } = fakeTabs({}, 3);
    const d = deps(tabs, restart, {
      config: { ...CONFIG, satirArasiBekleme: [10, 10] },
    });

    await processAllRows(d, [
      ROW,
      { metin: 'plajda', dosyaAdi: 'plaj' },
      { metin: 'dağda', dosyaAdi: 'dag' },
    ]);

    const staggers = d.sleeps.filter((x) => x.reason === 'startup').map((x) => x.ms);
    // Worker 0 never staggers (no 0 ms sleep is made), workers 1 and 2 do
    expect(staggers.sort((a, c) => a - c)).toEqual([10_000, 20_000]);
  });

  for (const name of ['limit', 'user', 'restart'] as const) {
    it(`pulls no new row while the ${name} gate is closed, continues once opened`, async () => {
      const { tabs, calls, restart } = fakeTabs({}, 1);
      const gates: JobGates = {
        limit: new Gate(),
        user: new Gate(),
        restart: new Gate(),
      };
      const d = deps(tabs, restart, { gates });
      gates[name].close();

      let finished = false;
      const run = processAllRows(d, [ROW]).then(() => {
        finished = true;
      });

      // A real macrotask wait is required: `await Promise.resolve()` advances
      // only one microtask, while the worker crosses several ticks before
      // reaching `generate` — even without the gate the test would not see
      // 'generate' yet at that point (false green).
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(calls).not.toContain('generate');
      expect(finished).toBe(false);

      gates[name].open();
      await run;
      expect(calls).toContain('generate');
    });
  }
});
