const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCoachStore } = require('../src/features/coach/model/createCoachStore.ts');

function fixture() {
  let now = 10000;
  let ids = 0;
  let fail = false;
  const records = [];
  const store = createCoachStore({ now: () => now, id: () => `session-${++ids}`,
    save: record => { if (fail) throw new Error('disk full'); records.push(record); } });
  const act = event => store.getState().dispatch(event);
  return { store, records, act, advance: value => { now += value; }, fail: value => { fail = value; } };
}
function start(f) {
  f.act({ type: 'start' });
  f.act({ type: 'pose', bodyVisible: true, angle: 170 });
  for (let i = 0; i < 3; i++) {
    f.advance(1000);
    f.act({ type: 'pose', bodyVisible: true, angle: 170 });
  }
  f.act({ type: 'tick' });
}

test('only a finished started workout is persisted, with active duration', () => {
  const f = fixture(); start(f); f.advance(5000);
  assert.equal(f.records.length, 0);
  f.act({ type: 'finish' });
  assert.equal(f.records.length, 1);
  assert.deepEqual(f.records[0], { id: 'session-1', mode: 'live', startedAt: 13000,
    endedAt: 18000, durationMs: 5000, reps: 0, target: 10 });
  assert.equal(f.store.getState().saveStatus, 'saved');
});

test('finish and retry after successful save do not duplicate a record', () => {
  const f = fixture(); start(f); f.act({ type: 'finish' });
  f.act({ type: 'finish' }); f.store.getState().save();
  assert.equal(f.records.length, 1);
});

test('failed save stays visible and retries the identical completed session', () => {
  const f = fixture(); start(f); f.fail(true); f.act({ type: 'finish' });
  const completed = f.store.getState().session;
  assert.equal(f.store.getState().saveStatus, 'error');
  assert.ok(f.store.getState().error);
  assert.equal(f.store.getState().newSession('live', 15), false);
  f.advance(9000); f.fail(false); f.store.getState().save();
  assert.equal(f.store.getState().saveStatus, 'saved');
  assert.strictEqual(f.store.getState().session, completed);
  assert.equal(f.records[0].endedAt, completed.endedAt);
});

test('preparation and countdown cancellation are not saved as real workouts', () => {
  for (const phase of ['preparing', 'countdown']) {
    const f = fixture(); f.act({ type: 'start' });
    if (phase === 'countdown') f.act({ type: 'pose', bodyVisible: true, angle: 170 });
    assert.equal(f.store.getState().session.phase, phase);
    assert.equal(f.store.getState().newSession('demo', 10), false);
    f.act({ type: 'finish' });
    const finished = f.store.getState().session;
    f.advance(10000);
    f.act({ type: 'pose', bodyVisible: true, angle: 170 }); f.act({ type: 'tick' });
    assert.strictEqual(f.store.getState().session, finished);
    assert.equal(finished.phase, 'finished');
    assert.equal(f.records.length, 0);
    assert.equal(f.store.getState().newSession('live', 10), true);
  }
});

test('demo remains labelled demo in storage and new sessions get fresh ids', () => {
  const f = fixture(); assert.equal(f.store.getState().newSession('demo', 20), true);
  start(f); f.act({ type: 'finish' });
  assert.equal(f.records[0].mode, 'demo');
  assert.equal(f.records[0].target, 20);
  assert.equal(f.store.getState().newSession('live', 10), true);
  assert.notEqual(f.store.getState().session.id, f.records[0].id);
});

test('cannot replace an active workout; explicit discard permits leaving a failed save', () => {
  const f = fixture(); start(f);
  assert.equal(f.store.getState().newSession('demo', 10), false);
  f.fail(true); f.act({ type: 'finish' });
  f.store.getState().discard();
  assert.equal(f.store.getState().saveStatus, 'discarded');
  assert.equal(f.store.getState().newSession('demo', 10), true);
});

test('cancelling resumed preparation saves the same id, completed reps and active time once', () => {
  const f = fixture(); start(f);
  for (const [delay, angle] of [[1, 170], [200, 170], [1, 90], [200, 90], [1, 170], [200, 170]]) {
    f.advance(delay); f.act({ type: 'pose', bodyVisible: true, angle });
  }
  f.advance(197); f.act({ type: 'pause' });
  const paused = f.store.getState().session;
  assert.equal(paused.elapsedMs, 800);
  assert.equal(paused.counter.reps, 1);
  f.advance(10000); f.act({ type: 'resume' });
  assert.equal(f.store.getState().session.phase, 'preparing');
  assert.equal(f.store.getState().session.id, paused.id);
  assert.equal(f.store.getState().session.startedAt, 13000);
  assert.equal(f.store.getState().newSession('demo', 10), false);
  f.advance(5000); f.act({ type: 'finish' }); f.act({ type: 'finish' });
  assert.deepEqual(f.records, [{ id: 'session-1', mode: 'live', startedAt: 13000,
    endedAt: 28800, durationMs: 800, reps: 1, target: 10 }]);
});
