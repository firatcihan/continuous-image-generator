import { describe, expect, it, vi } from 'vitest';
import { JobManager } from '../src/job/jobManager.js';
import type { JobStatus, JobEvent } from '../src/job/events.js';
import type { Config, ImageResult, Row, GenerationTab } from '../src/types.js';

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

const ROWS: Row[] = [
  { metin: 'karda', dosyaAdi: 'kedi_kar' },
  { metin: 'plajda', dosyaAdi: 'kedi_plaj' },
];

function fakeTab(results: ImageResult[] = []): GenerationTab {
  const queue = [...results];
  return {
    openNewChat: async () => {},
    isLoggedIn: async () => true,
    activeModelName: async () => 'GPT-5',
    generateImage: async () => queue.shift() ?? { type: 'image' },
    saveLastImage: async () => {},
  };
}

function options(extra: Partial<Parameters<JobManager['start']>[0]> = {}) {
  return {
    projectId: 'proje-1',
    config: CONFIG,
    rows: ROWS,
    tabs: [fakeTab()],
    restartBrowser: async () => {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    isCompleted: () => false,
    recordFailure: () => {},
    sleepEngine: async () => {},
    ...extra,
  };
}

describe('JobManager', () => {
  it('starts in the idle status', () => {
    const m = new JobManager();
    expect(m.info().status).toBe('idle');
    expect(m.info().projectId).toBeNull();
  });

  it('moves to finished when the job ends and emits the summary', async () => {
    const m = new JobManager();
    const events: JobEvent[] = [];
    m.listen((e) => events.push(e));

    const summary = await m.start(options());

    expect(summary).toEqual({ succeeded: 2, skipped: 0, failed: 0 });
    expect(m.info().status).toBe('finished');
    expect(events.at(-1)).toEqual({ type: 'finished', summary });
  });

  it('emits row events and the imageReady event', async () => {
    const m = new JobManager();
    const events: JobEvent[] = [];
    m.listen((e) => events.push(e));

    await m.start(options({ rows: [ROWS[0]] }));

    const types = events.map((e) => e.type);
    expect(types).toContain('rowStarted');
    expect(types).toContain('imageReady');
    expect(types).toContain('rowFinished');
  });

  it('a stop call takes the job to the stopped status', async () => {
    const m = new JobManager();
    const run = m.start(
      options({
        sleepEngine: async () => {
          m.stop();
        },
      }),
    );
    const summary = await run;
    expect(m.info().status).toBe('stopped');
    expect(summary.succeeded).toBe(1);
  });

  it('pause and resume switch the status', async () => {
    const m = new JobManager();
    let paused = false;
    const run = m.start(
      options({
        sleepEngine: async () => {
          if (!paused) {
            paused = true;
            m.pause();
            expect(m.info().status).toBe('paused');
            setTimeout(() => m.resume(), 0);
          }
        },
      }),
    );
    await run;
    expect(m.info().status).toBe('finished');
  });

  it('enters waitingLimit during a rate-limit sleep and emits the countdown', async () => {
    const m = new JobManager();
    const events: JobEvent[] = [];
    m.listen((e) => events.push(e));

    await m.start(
      options({
        rows: [ROWS[0]],
        tabs: [fakeTab([{ type: 'rateLimit', message: 'Try again in 2 minutes.' }, { type: 'image' }])],
        sleepEngine: async (_ms, opts) => {
          opts.tick?.(120_000);
        },
      }),
    );

    expect(events).toContainEqual({ type: 'limitWaiting', remainingSec: 120 });
  });

  it('stays in waitingUser when the session drops, continues after userReady', async () => {
    let loggedIn = false;
    const tab = fakeTab();
    tab.isLoggedIn = async () => loggedIn;

    const m = new JobManager();
    const events: JobEvent[] = [];
    m.listen((e) => {
      events.push(e);
      if (e.type === 'userNeeded') {
        loggedIn = true;
        setTimeout(() => m.userReady(), 0);
      }
    });

    await m.start(options({ rows: [ROWS[0]], tabs: [tab] }));

    expect(events.some((e) => e.type === 'userNeeded')).toBe(true);
    expect(m.info().status).toBe('finished');
  });

  it('refuses to start a second job at the same time', async () => {
    const m = new JobManager();
    let resolver: (() => void) | undefined;
    const run = m.start(
      options({
        sleepEngine: () => new Promise<void>((resolve) => (resolver = resolve)),
      }),
    );

    await Promise.resolve();
    await expect(m.start(options())).rejects.toThrow('zaten çalışıyor');

    // Wait for sleepEngine to REALLY be called. Trusting a fixed number of
    // microtasks was fragile: when the number of `await`s the worker crosses
    // before reaching the sleep changed, the resolver was never assigned and
    // the job hung forever.
    while (resolver === undefined) await new Promise((resolve) => setTimeout(resolve, 0));

    resolver();
    m.stop();
    await run;
  });

  it('moves to error on an unexpected failure and emits an error event', async () => {
    const tab = fakeTab();
    tab.openNewChat = async () => {
      throw new Error('çöktü');
    };
    const restartBrowser = async () => {
      throw new Error('yeniden başlatılamadı');
    };

    const m = new JobManager();
    const events: JobEvent[] = [];
    m.listen((e) => events.push(e));

    await expect(
      m.start(options({ tabs: [tab], restartBrowser })),
    ).rejects.toThrow();
    expect(m.info().status).toBe('error');
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('listen() unsubscribes via the returned function', async () => {
    const m = new JobManager();
    const events: JobEvent[] = [];
    const unsubscribe = m.listen((e) => events.push(e));
    unsubscribe();
    await m.start(options({ rows: [ROWS[0]] }));
    expect(events).toHaveLength(0);
  });

  it('a stop arriving during the rate-limit sleep never flips back to a bogus running status', async () => {
    const m = new JobManager();
    const statuses: JobStatus[] = [];
    m.listen((e) => {
      if (e.type === 'status') statuses.push(e.status);
    });

    await m.start(
      options({
        rows: [ROWS[0]],
        tabs: [fakeTab([{ type: 'rateLimit', message: 'Try again in 2 minutes.' }])],
        sleepEngine: async (_ms, opts) => {
          // stop is only called during the rate-limit sleep (tick defined)
          if (opts.tick) m.stop();
        },
      }),
    );

    expect(statuses).toEqual(['running', 'waitingLimit', 'stopped']);
  });

  it('a delayed userReady call after stop never turns the status into a bogus running', async () => {
    const tab = fakeTab();
    tab.isLoggedIn = async () => false;

    const m = new JobManager();
    const statuses: JobStatus[] = [];
    m.listen((e) => {
      if (e.type === 'status') statuses.push(e.status);
      if (e.type === 'userNeeded') {
        // stop consumes and nulls userResolver; the delayed/stale userReady
        // call right after it must do nothing
        setTimeout(() => {
          m.stop();
          m.userReady();
        }, 0);
      }
    });

    await m.start(options({ rows: [ROWS[0]], tabs: [tab] }));

    expect(statuses).toEqual(['running', 'waitingUser', 'stopped']);
  });

  it(
    'a synchronous stop() reaction to the userNeeded event causes no deadlock (FINDING 1)',
    async () => {
      const tab = fakeTab();
      tab.isLoggedIn = async () => false;

      const m = new JobManager();
      const statuses: JobStatus[] = [];
      m.listen((e) => {
        if (e.type === 'status') statuses.push(e.status);
        if (e.type === 'userNeeded') {
          // SYNCHRONOUS reaction: the listener calls stop() before returning
          // from the emit. If waitForUser had not assigned the resolver yet
          // (the old code), the returned promise would hang forever.
          m.stop();
        }
      });

      await expect(
        m.start(options({ rows: [ROWS[0]], tabs: [tab] })),
      ).resolves.toBeDefined();

      expect(statuses).toContain('waitingUser');
      expect(m.info().status).toBe('stopped');
    },
    2000,
  );

  it('an exception thrown by one listener breaks neither the other listeners nor the job (FINDING 2)', async () => {
    const m = new JobManager();
    const events: JobEvent[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Registration order matters: the first listener throws on EVERY event
    // (including the first synchronous 'running' status emit). In the old
    // code that rejected start() before it entered the try block, leaving the
    // status stuck at 'running' forever.
    m.listen(() => {
      throw new Error('bozuk dinleyici (ör. SSE istemcisi EPIPE fırlatıyor)');
    });
    m.listen((e) => events.push(e));

    const summary = await m.start(options());

    expect(summary).toEqual({ succeeded: 2, skipped: 0, failed: 0 });
    expect(m.info().status).toBe('finished');
    expect(events.some((e) => e.type === 'finished')).toBe(true);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it(
    'pause/resume during the rate-limit sleep returns to the waitingLimit status (FINDING 3)',
    async () => {
      const m = new JobManager();
      const statuses: JobStatus[] = [];
      m.listen((e) => {
        if (e.type === 'status') statuses.push(e.status);
      });

      let paused = false;
      await m.start(
        options({
          rows: [ROWS[0]],
          tabs: [fakeTab([
            { type: 'rateLimit', message: 'Try again in 2 minutes.' },
            { type: 'image' },
          ])],
          sleepEngine: async (_ms, opts) => {
            if (opts.tick && !paused) {
              paused = true;
              m.pause();
              expect(m.info().status).toBe('paused');
              m.resume();
            }
          },
        }),
      );

      const pauseIndex = statuses.indexOf('paused');
      expect(pauseIndex).toBeGreaterThan(-1);
      // After resume() it must return to the pre-pause 'waitingLimit', NOT 'running'.
      expect(statuses[pauseIndex + 1]).toBe('waitingLimit');
    },
    2000,
  );

  it('row is updated even when every row is skipped and rowStarted never fires (FINDING 4)', async () => {
    const m = new JobManager();

    const summary = await m.start(options({ isCompleted: () => true }));

    expect(summary).toEqual({ succeeded: 0, skipped: ROWS.length, failed: 0 });
    const info = m.info();
    expect(info.row).toBe(ROWS.length);
    expect(info.total).toBe(ROWS.length);
  });

  it('info() carries the done count and the in-flight files', async () => {
    const m = new JobManager();
    const inFlightSnapshots: string[][] = [];
    m.listen((event) => {
      if (event.type === 'rowStarted') inFlightSnapshots.push(m.info().inFlight);
    });

    await m.start(options({ rows: [ROWS[0], ROWS[1]] }));

    // While a row starts, its file must appear in flight
    expect(inFlightSnapshots[0]).toContain(ROWS[0].dosyaAdi);
    // When the job ends the in-flight list must drain
    expect(m.info().inFlight).toEqual([]);
    expect(m.info().done).toBe(2);
  });

  it('the rowFinished event carries the file name and the fresh summary', async () => {
    const m = new JobManager();
    const finished: Array<{ fileName: string; succeeded: number }> = [];
    m.listen((event) => {
      if (event.type === 'rowFinished') {
        finished.push({ fileName: event.fileName, succeeded: event.summary.succeeded });
      }
    });

    await m.start(options({ rows: [ROWS[0]] }));

    expect(finished).toEqual([{ fileName: ROWS[0].dosyaAdi, succeeded: 1 }]);
  });
});

// The whole automation hangs off ChatGPT's DOM. When a selector stops
// matching — the UI shipped a change — every row spent a 30 s waitForSelector
// timeout, burned its retries and dragged a full browser restart along, so a
// 200-row job thrashed for hours before reporting anything useful. One probe
// before the first row turns that into an immediate, readable failure.
describe('preflight', () => {
  it('fails before any row when the chat cannot be opened', async () => {
    const m = new JobManager();
    const events: JobEvent[] = [];
    m.listen((e) => events.push(e));
    let restarts = 0;
    let generated = 0;
    const broken: GenerationTab = {
      ...fakeTab(),
      openNewChat: async () => {
        throw new Error('Timeout 30000ms exceeded waiting for #prompt-textarea');
      },
      generateImage: async () => { generated++; return { type: 'image' }; },
    };

    await expect(m.start(options({
      tabs: [broken],
      restartBrowser: async () => { restarts++; },
    }))).rejects.toThrow(/ChatGPT arayüzüne ulaşılamadı/);

    expect(m.info().status).toBe('error');
    expect(generated).toBe(0);
    expect(restarts).toBe(0);
    expect(events.some((e) => e.type === 'rowStarted')).toBe(false);
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('keeps the original failure in the message so the cause stays visible', async () => {
    const m = new JobManager();
    const broken: GenerationTab = {
      ...fakeTab(),
      openNewChat: async () => { throw new Error('net::ERR_INTERNET_DISCONNECTED'); },
    };

    await expect(m.start(options({ tabs: [broken] })))
      .rejects.toThrow(/ERR_INTERNET_DISCONNECTED/);
  });

  it('runs the job normally when the chat opens', async () => {
    const m = new JobManager();
    const summary = await m.start(options({ rows: [ROWS[0]] }));
    expect(summary.succeeded).toBe(1);
    expect(m.info().status).toBe('finished');
  });

  // The probe has to tell "this UI is broken" apart from "one bad moment". A
  // single crash or a slow first load landing exactly here must not kill the
  // job with a message blaming the selectors.
  it('shrugs off a single hiccup and runs the job', async () => {
    const m = new JobManager();
    let calls = 0;
    const flaky: GenerationTab = {
      ...fakeTab(),
      openNewChat: async () => {
        calls++;
        if (calls === 1) throw new Error('tarayıcı çöktü');
      },
    };

    const summary = await m.start(options({ rows: [ROWS[0]], tabs: [flaky] }));

    expect(summary.succeeded).toBe(1);
    expect(m.info().status).toBe('finished');
  });
});

// `POST /api/job/start` answers 202 the moment the request arrives, then the
// real work (mkdir on the output folder, opening the browser, preparing tabs)
// runs detached in start.ts. Anything thrown there used to reach only
// calisma.log: the manager stayed 'idle', no event went out, and the user who
// pressed Başlat saw absolutely nothing happen. `fail()` is how that detached
// failure gets back onto the screen.
describe('fail', () => {
  it('moves to the error status and emits the message', () => {
    const m = new JobManager();
    const events: JobEvent[] = [];
    m.listen((e) => events.push(e));

    m.fail('çıktı klasörü oluşturulamadı');

    expect(m.info().status).toBe('error');
    expect(events).toContainEqual({ type: 'error', message: 'çıktı klasörü oluşturulamadı' });
  });

  it('reports the project the failure belongs to', () => {
    const m = new JobManager();
    const statuses: Array<{ status: JobStatus; projectId: string | null }> = [];
    m.listen((e) => {
      if (e.type === 'status') statuses.push({ status: e.status, projectId: e.projectId });
    });

    m.fail('tarayıcı açılamadı', 'proje-7');

    expect(m.info().projectId).toBe('proje-7');
    expect(statuses).toContainEqual({ status: 'error', projectId: 'proje-7' });
  });

  // Two start requests can slip past the busy check together (the route
  // answers before the job actually starts). The second one's failure must not
  // knock the job the FIRST one really started out of 'running'.
  it('leaves a busy job alone', async () => {
    const m = new JobManager();
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });

    const running = m.start(options({
      rows: [ROWS[0]],
      tabs: [{ ...fakeTab(), generateImage: async () => { await held; return { type: 'image' }; } }],
    }));
    expect(m.info().status).toBe('running');

    m.fail('ikinci başlatma patladı');

    expect(m.info().status).toBe('running');
    release();
    await running;
    expect(m.info().status).toBe('finished');
  });
});

describe('parallel coordination', () => {
  it('when two tabs see a rate limit at the same time only one sleep happens', async () => {
    const sleeps: number[] = [];
    const m = new JobManager();
    const limit = { type: 'rateLimit', message: 'Try again in 2 minutes.' } as const;

    // The sleep is held until BOTH tabs returned the limit. Otherwise the
    // first tab's sleep ends before the second tab even sees the limit; the
    // detections never overlap and two separate sleeps would be the CORRECT
    // behavior — the test would prove nothing.
    let limitReturners = 0;
    let bothSaw!: () => void;
    const overlap = new Promise<void>((resolve) => (bothSaw = resolve));

    const limitedTab = (): GenerationTab => {
      const t = fakeTab();
      let first = true;
      t.generateImage = async () => {
        if (!first) return { type: 'image' };
        first = false;
        limitReturners++;
        // Macrotask: release only after the second tab ENTERED the sleep wrapper
        if (limitReturners === 2) setTimeout(bothSaw, 0);
        return limit;
      };
      return t;
    };

    await m.start(
      options({
        rows: [ROWS[0], ROWS[1]],
        tabs: [limitedTab(), limitedTab()],
        sleepEngine: async (ms, opts) => {
          if (!opts.tick) return; // startup / between-rows sleeps pass instantly
          sleeps.push(ms);
          await overlap;
        },
      }),
    );

    // Both tabs saw the limit but SingleExecutor tied them to a single sleep
    expect(sleeps.filter((ms) => ms === 2 * 60_000)).toHaveLength(1);
  });

  it('when two tabs see a dropped session at the same time a single userNeeded event fires', async () => {
    const m = new JobManager();
    // The flag is PER TAB: with a single shared flag the second tab would see
    // the session already open and vacuum the test — a single event would
    // fire even without the guard.
    const tab = () => {
      const t = fakeTab();
      let first = true;
      t.isLoggedIn = async () => {
        if (!first) return true;
        first = false;
        return false;
      };
      return t;
    };

    const events: string[] = [];
    m.listen((event) => {
      events.push(event.type);
      if (event.type === 'userNeeded') setTimeout(() => m.userReady(), 0);
    });

    await m.start(
      options({ rows: [ROWS[0], ROWS[1]], tabs: [tab(), tab()] }),
    );

    expect(events.filter((t) => t === 'userNeeded')).toHaveLength(1);
  });

  it('when two tabs crash at the same time the browser restarts once', async () => {
    const m = new JobManager();
    let restartCount = 0;

    // The restart is held until BOTH tabs crashed — otherwise the first
    // finishes, the second crash lands at a different time and two restarts
    // would be the CORRECT behavior.
    let crashCount = 0;
    let bothCrashed!: () => void;
    const overlap = new Promise<void>((resolve) => (bothCrashed = resolve));

    const tabs = [0, 1].map((index) => {
      const t = fakeTab();
      // start() probes tabs[0] before any row is pulled; that call must not
      // eat this tab's scripted crash, or only ONE tab would crash during the
      // run and the test would pass without testing the overlap at all.
      let preflightPending = index === 0;
      let firstCall = true;
      t.openNewChat = async () => {
        if (preflightPending) {
          preflightPending = false;
          return;
        }
        if (!firstCall) return;
        firstCall = false;
        crashCount++;
        // Macrotask: release only after the second worker ENTERED the wrapper
        if (crashCount === 2) setTimeout(bothCrashed, 0);
        throw new Error('tarayıcı çöktü');
      };
      return t;
    });

    await m.start(
      options({
        rows: [ROWS[0], ROWS[1]],
        tabs,
        restartBrowser: async () => {
          restartCount++;
          await overlap;
        },
      }),
    );

    expect(restartCount).toBe(1);
  });
});
