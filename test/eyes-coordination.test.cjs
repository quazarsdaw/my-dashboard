const test = require('node:test'),
  assert = require('node:assert/strict');
const B = require('../browser-lock.js'),
  E = require('../eyes-coordination.js');
function mutex() {
  let chain = Promise.resolve();
  return {
    request(_name, _opts, fn) {
      const next = chain.then(() => fn({}));
      chain = next.catch(() => {});
      return next;
    },
  };
}
function storage() {
  const m = new Map();
  return {
    getItem: (k) => m.get(k) || null,
    setItem: (k, v) => m.set(k, v),
    removeItem: (k) => m.delete(k),
  };
}
test('duplicate tab с скопированным sessionStorage не переиспользует владение', async () => {
  const s = storage(),
    locks = mutex();
  const make = () =>
    E.create({
      locks,
      storage: s,
      now: () => 1000,
      uuid: require('node:crypto').randomUUID,
      tabId: 'copied-tab',
    });
  const a = make(),
    b = make();
  const x = await a.claimSession({ id: 'same', owner: 'user' });
  assert.equal(x.ok, true);
  assert.equal((await b.claimSession({ id: 'same', owner: 'user' })).ok, false);
  assert.equal(await a.renewSession(x.token), true);
});
test('параллельные вкладки не владеют одним активным уроком разминки', async () => {
  const locks = mutex(),
    s = storage();
  let now = 1000;
  const make = (tabId) =>
    E.create({
      locks,
      storage: s,
      now: () => now,
      uuid: () => tabId + '-token',
      tabId,
    });
  const a = make('a'),
    b = make('b');
  const [x, y] = await Promise.all([
    a.claimSession({ id: 'one', owner: 'local' }),
    b.claimSession({ id: 'two', owner: 'local' }),
  ]);
  assert.equal(x.ok, true);
  assert.equal(y.ok, false);
  assert.equal(await b.releaseSession('wrong'), false);
  assert.equal(await a.renewSession(x.token), true);
  now = 17000;
  assert.equal((await b.claimSession({ id: 'two', owner: 'local' })).ok, true);
  assert.equal(await a.releaseSession(x.token), false);
});
test('исключение освобождает mutex и недоступный atomic fallback не пропускает запись', async () => {
  const b = B.create({ locks: mutex() });
  await assert.rejects(
    b.withLock('x', () => {
      throw Error('failure');
    }),
  );
  assert.equal(await b.withLock('x', () => 7), 7);
  let ran = false;
  await assert.rejects(
    B.create({}).withLock('x', () => (ran = true)),
    /COORDINATION_UNAVAILABLE/,
  );
  assert.equal(ran, false);
});
test('pagehide синхронно отзывает только своё владение и reload не ждёт ttl', async () => {
  const s = storage(), locks = mutex();
  const make = () => E.create({ locks, storage: s, now: () => 1000,
    uuid: require('node:crypto').randomUUID, tabId: 'copied-tab' });
  const old = make(), duplicate = make();
  const first = await old.claimSession({ id: 'same', owner: 'user' });
  assert.equal((await duplicate.claimSession({ id: 'same', owner: 'user' })).ok, false);
  assert.equal(typeof old.retireSession, 'function');
  assert.equal(duplicate.retireSession(first.token), false);
  assert.equal(old.retireSession(first.token), true, 'не promise и не callback mutex');
  assert.equal(old.active(), null);
  const restored = make();
  const next = await restored.claimSession({ id: 'same', owner: 'user' });
  assert.equal(next.ok, true);
  assert.notEqual(next.token, first.token);
  assert.equal(old.retireSession(first.token), false);
  assert.equal(await old.releaseSession(first.token), false);
  assert.equal(await restored.renewSession(next.token), true);
  assert.equal((await duplicate.claimSession({ id: 'same', owner: 'user' })).ok, false);
  assert.equal(await restored.releaseSession(next.token), true);
  assert.equal(s.getItem('_eye_break_session_retired_v1:' + first.token), null,
    'новое владение убирает служебную отметку прошлого lease');
});
