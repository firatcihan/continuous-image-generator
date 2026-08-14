import { describe, expect, it } from 'vitest';
import { SingleExecutor } from '../src/job/singleExecutor.js';

/** Manually resolvable promise — puts timing under the test's control. */
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SingleExecutor', () => {
  it('two simultaneous calls run the work only once', async () => {
    const executor = new SingleExecutor();
    const gate = deferred();
    let counter = 0;
    const work = () => {
      counter++;
      return gate.promise;
    };

    const first = executor.run(work);
    const second = executor.run(work);

    expect(counter).toBe(1);
    gate.resolve();
    await Promise.all([first, second]);
    expect(counter).toBe(1);
  });

  it('the second call waits for the running one to finish', async () => {
    const executor = new SingleExecutor();
    const gate = deferred();
    let secondFinished = false;

    const first = executor.run(() => gate.promise);
    const second = executor.run(() => gate.promise).then(() => {
      secondFinished = true;
    });

    await Promise.resolve();
    expect(secondFinished).toBe(false);

    gate.resolve();
    await Promise.all([first, second]);
    expect(secondFinished).toBe(true);
  });

  it('a call arriving after the run finished starts the work again', async () => {
    const executor = new SingleExecutor();
    let counter = 0;
    const work = async () => {
      counter++;
    };

    await executor.run(work);
    await executor.run(work);
    expect(counter).toBe(2);
  });

  it('when the work throws, both calls see the error and the next call reruns', async () => {
    const executor = new SingleExecutor();
    const gate = deferred();
    let counter = 0;
    const work = () => {
      counter++;
      return gate.promise;
    };

    const first = executor.run(work);
    const second = executor.run(work);
    gate.reject(new Error('patladı'));

    await expect(first).rejects.toThrow('patladı');
    await expect(second).rejects.toThrow('patladı');

    await executor.run(async () => {
      counter++;
    });
    expect(counter).toBe(2);
  });
});
