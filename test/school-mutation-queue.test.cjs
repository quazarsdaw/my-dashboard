const assert = require('node:assert/strict');
const test = require('node:test');
const SchoolMutationQueue = require('../school-mutation-queue.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('executes rapid mutations sequentially and revalidates once', async () => {
  const first = deferred();
  const calls = [];
  const queue = SchoolMutationQueue.create({
    execute(entry) {
      calls.push(entry.command.operation);
      return entry.id === 'a' ? first.promise : Promise.resolve(entry.id);
    },
    async afterBatch() {
      calls.push('revalidate');
    }
  });

  const a = queue.enqueue({ id: 'a', keys: ['lesson-a'], command: { operation: 'moveLesson' } });
  const b = queue.enqueue({ id: 'b', keys: ['lesson-b'], command: { operation: 'moveLesson' } });
  assert.deepEqual(calls, ['moveLesson']);
  first.resolve('a');
  await Promise.all([a, b]);
  await queue.whenIdle();
  assert.deepEqual(calls, ['moveLesson', 'moveLesson', 'revalidate']);
});

test('keeps processing after one mutation fails', async () => {
  const calls = [];
  const queue = SchoolMutationQueue.create({
    execute(entry) {
      calls.push(entry.id);
      return entry.id === 'bad' ? Promise.reject(new Error('notion failed')) : Promise.resolve(entry.id);
    },
    async afterBatch() {
      calls.push('revalidate');
    }
  });

  const bad = queue.enqueue({ id: 'bad', keys: ['lesson-a'], command: {} });
  const good = queue.enqueue({ id: 'good', keys: ['lesson-b'], command: {} });
  await assert.rejects(bad, /notion failed/);
  assert.equal(await good, 'good');
  await queue.whenIdle();
  assert.deepEqual(calls, ['bad', 'good', 'revalidate']);
});

