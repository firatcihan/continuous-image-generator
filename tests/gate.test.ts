import { describe, expect, it } from 'vitest';
import { Gate } from '../src/job/gate.js';

describe('Gate', () => {
  it('is open by default and pass() returns immediately', async () => {
    const gate = new Gate();
    expect(gate.isOpen()).toBe(true);
    await gate.pass();
  });

  it('blocks while closed, releases with open()', async () => {
    const gate = new Gate();
    gate.close();
    expect(gate.isOpen()).toBe(false);

    let passed = false;
    const waiter = gate.pass().then(() => {
      passed = true;
    });

    await Promise.resolve();
    expect(passed).toBe(false);

    gate.open();
    await waiter;
    expect(passed).toBe(true);
  });

  it('releases multiple waiters with a single open()', async () => {
    const gate = new Gate();
    gate.close();
    const waiters = [gate.pass(), gate.pass(), gate.pass()];
    gate.open();
    await Promise.all(waiters);
    expect(gate.isOpen()).toBe(true);
  });

  it('calling open() while already open causes no trouble', () => {
    const gate = new Gate();
    gate.open();
    expect(gate.isOpen()).toBe(true);
  });
});
