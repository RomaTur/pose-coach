const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createWorkout,
  reduceWorkout,
  elapsedWorkoutMs,
  countdownSeconds,
} = require('../src/features/coach/model/workoutSession.ts');

function activate(state = createWorkout('session', 'live'), now = 0) {
  const countdown = visibleThrough(prepare(state, now), now + 1000, now + 2000, now + 3000);
  return reduceWorkout(countdown, { type: 'tick', now: now + 3000 });
}

function prepare(state = createWorkout('session', 'live'), now = 0, type = 'start') {
  return visibleThrough(reduceWorkout(state, { type, now }), now);
}

function visibleThrough(state, ...times) {
  return poses(state, times.map(now => [170, now]));
}

function poses(state, samples) {
  return samples.reduce((current, [angle, now, bodyVisible = true]) =>
    reduceWorkout(current, { type: 'pose', angle, now, bodyVisible }), state);
}

function completeRep(state, now) {
  return poses(state, [[170, now], [170, now + 200], [90, now + 300],
    [90, now + 500], [170, now + 600], [170, now + 800]]);
}

test('a new workout has no elapsed time, timestamps or inherited repetitions', () => {
  const state = createWorkout('session', 'live');
  assert.equal(state.id, 'session');
  assert.equal(state.mode, 'live');
  assert.equal(state.target, 10);
  assert.equal(state.phase, 'setup');
  for (const field of ['startedAt', 'endedAt', 'countdownUntil', 'activeSince', 'lastEventAt', 'lastPoseAt']) {
    assert.equal(state[field], null);
  }
  assert.equal(state.elapsedMs, 0);
  assert.equal(state.counter.reps, 0);
  assert.equal(state.counter.phase, 'ready');
  assert.equal(elapsedWorkoutMs(state, 10000), 0);
  assert.equal(countdownSeconds(state, 10000), 0);
});

test('constructor rejects invalid identity, mode and noninteger or out-of-range targets', () => {
  for (const id of ['', '  ', null, undefined, 1]) assert.throws(() => createWorkout(id, 'live'));
  for (const mode of ['', 'unknown', null, undefined]) assert.throws(() => createWorkout('id', mode));
  for (const target of [0, -1, 101, 1.5, NaN, Infinity, -Infinity, '10', null]) {
    assert.throws(() => createWorkout('id', 'live', target));
  }
  assert.equal(createWorkout('minimum', 'live', 1).target, 1);
  assert.equal(createWorkout('maximum', 'demo', 100).target, 100);
});

test('setup cannot resume, pause or finish', () => {
  const state = createWorkout('session', 'live');
  for (const event of [
    { type: 'resume', now: 0, bodyVisible: true },
    { type: 'pause', now: 0 },
    { type: 'finish', now: 0 },
  ]) assert.strictEqual(reduceWorkout(state, event), state);
});

test('start counts down exactly three seconds and does not count preparation as active time', () => {
  let state = prepare(createWorkout('session', 'live'), 100);
  assert.equal(state.phase, 'countdown');
  assert.equal(state.countdownUntil, 3100);
  assert.equal(state.lastEventAt, 100);
  assert.equal(state.startedAt, null);
  assert.equal(state.activeSince, null);
  assert.equal(countdownSeconds(state, 100), 3);
  assert.equal(countdownSeconds(state, 1100), 2);
  assert.equal(countdownSeconds(state, 2099), 2);
  assert.equal(countdownSeconds(state, 2100), 1);
  state = visibleThrough(state, 1100, 2100);
  state = reduceWorkout(state, { type: 'tick', now: 3099 });
  assert.equal(state.phase, 'countdown');
  assert.equal(state.lastEventAt, 3099);
  assert.equal(countdownSeconds(state, 3099), 1);
  assert.equal(countdownSeconds(state, 3100), 0);
  assert.equal(elapsedWorkoutMs(state, 3100), 0);
  state = reduceWorkout(state, { type: 'tick', now: 3100 });
  assert.equal(state.phase, 'active');
  assert.equal(state.startedAt, 3100);
  assert.equal(state.activeSince, 3100);
  assert.equal(state.countdownUntil, null);
  assert.equal(state.lastEventAt, 3100);
  assert.equal(elapsedWorkoutMs(state, 3600), 500);
  assert.equal(countdownSeconds(state, 3600), 0);
});

test('a late tick starts active time at the actual tick, not the countdown deadline', () => {
  const countdown = visibleThrough(prepare(), 1000, 2000, 3000, 4000);
  const active = reduceWorkout(countdown, { type: 'tick', now: 5000 });
  assert.equal(active.startedAt, 5000);
  assert.equal(active.activeSince, 5000);
  assert.equal(elapsedWorkoutMs(active, 5500), 500);
});

test('a pose cannot replace the tick required to enter active after the deadline', () => {
  let state = visibleThrough(prepare(), 1000, 2000, 3000);
  state = reduceWorkout(state, { type: 'pose', angle: 170, bodyVisible: true, now: 4000 });
  assert.equal(state.phase, 'countdown');
  assert.equal(state.startedAt, null);
  assert.equal(state.counter.armed, false);
  state = reduceWorkout(state, { type: 'tick', now: 4000 });
  assert.equal(state.phase, 'active');
  assert.equal(state.startedAt, 4000);
});

test('body loss cancels countdown and returning body restarts three seconds without another press', () => {
  let state = prepare();
  state = reduceWorkout(state, { type: 'pose', angle: 170, now: 1000, bodyVisible: false });
  assert.equal(state.phase, 'preparing');
  assert.equal(state.countdownUntil, null);
  assert.equal(state.activeSince, null);
  assert.equal(state.startedAt, null);
  assert.equal(state.elapsedMs, 0);
  state = reduceWorkout(state, { type: 'tick', now: 4000 });
  assert.equal(state.phase, 'preparing');
  state = visibleThrough(state, 5000);
  assert.equal(state.phase, 'countdown');
  assert.equal(state.countdownUntil, 8000);
  state = visibleThrough(state, 6000, 7000);
  assert.equal(reduceWorkout(state, { type: 'tick', now: 7999 }).phase, 'countdown');
  state = reduceWorkout(state, { type: 'tick', now: 8000 });
  assert.equal(state.phase, 'active');
  assert.equal(state.startedAt, 8000);
});

test('active poses reuse the squat FSM and target is guidance, not an automatic finish', () => {
  let state = activate(createWorkout('session', 'live', 1));
  state = completeRep(state, 3000);
  assert.equal(state.counter.reps, 1);
  assert.equal(state.phase, 'active');
  state = completeRep(state, 3900);
  assert.equal(state.counter.reps, 2);
  assert.equal(state.phase, 'active');
  assert.equal(state.target, 1);
  assert.equal(state.endedAt, null);
});

test('setup, preparing, countdown and paused poses cannot advance the squat FSM', () => {
  const setup = createWorkout('session', 'live');
  const preparing = reduceWorkout(setup, { type: 'start', now: 0 });
  const countdown = prepare();
  const paused = reduceWorkout(activate(), { type: 'pause', now: 4000 });
  for (const state of [setup, preparing, countdown, paused]) {
    const next = completeRep(state, 5000);
    assert.equal(next.phase, state.phase === 'preparing' ? 'countdown' : state.phase);
    assert.deepEqual(next.counter, state.counter);
    assert.equal(next.counter.reps, 0);
  }
});

test('invisible active pose aborts a partial repetition despite a plausible angle', () => {
  let state = completeRep(activate(), 3000);
  state = poses(state, [[90, 3900], [90, 4100]]);
  assert.equal(state.counter.phase, 'down');
  state = reduceWorkout(state, { type: 'pose', angle: 170, bodyVisible: false, now: 4200 });
  assert.equal(state.phase, 'active');
  assert.equal(state.counter.phase, 'ready');
  assert.equal(state.counter.armed, false);
  state = poses(state, [[170, 4300], [170, 4500]]);
  assert.equal(state.counter.reps, 1);
});

test('pause excludes waiting, preserves reps and first start, and clears the partial repetition', () => {
  let state = completeRep(activate(), 3000);
  state = poses(state, [[90, 3900], [90, 4100]]);
  state = reduceWorkout(state, { type: 'pause', now: 4200 });
  assert.equal(state.phase, 'paused');
  assert.equal(state.elapsedMs, 1200);
  assert.equal(state.activeSince, null);
  assert.equal(state.countdownUntil, null);
  assert.equal(state.counter.reps, 1);
  assert.equal(state.counter.phase, 'ready');
  assert.equal(state.counter.armed, false);
  assert.equal(state.counter.holdStartedAtMs, null);
  assert.equal(state.counter.lastTimestampMs, null);
  assert.equal(elapsedWorkoutMs(state, 10000), 1200);
  state = reduceWorkout(state, { type: 'resume', now: 9000 });
  assert.equal(state.phase, 'preparing');
  assert.equal(state.countdownUntil, null);
  assert.equal(state.lastPoseAt, null);
  assert.equal(state.id, 'session');
  assert.equal(state.counter.reps, 1);
  state = visibleThrough(state, 10000);
  assert.equal(state.countdownUntil, 13000);
  assert.equal(elapsedWorkoutMs(state, 12000), 1200);
  state = visibleThrough(state, 11000, 12000);
  state = reduceWorkout(state, { type: 'tick', now: 13000 });
  assert.equal(state.startedAt, 3000);
  assert.equal(state.activeSince, 13000);
  state = poses(state, [[90, 13100], [90, 13300], [170, 13400], [170, 13600]]);
  assert.equal(state.counter.reps, 1);
  assert.equal(elapsedWorkoutMs(state, 14000), 2200);
  state = reduceWorkout(state, { type: 'pause', now: 14000 });
  assert.equal(state.elapsedMs, 2200);
  assert.equal(elapsedWorkoutMs(state, 100000), 2200);
});

test('pausing a countdown adds no active time and clears its deadline', () => {
  const countdown = prepare();
  const state = reduceWorkout(countdown, { type: 'pause', now: 1000 });
  assert.equal(state.phase, 'paused');
  assert.equal(state.countdownUntil, null);
  assert.equal(state.activeSince, null);
  assert.equal(state.startedAt, null);
  assert.equal(state.elapsedMs, 0);
  assert.equal(countdownSeconds(state, 1000), 0);
});

test('start cannot restart preparation or an active workout; resume is only for paused', () => {
  const preparing = reduceWorkout(createWorkout('session', 'live'), { type: 'start', now: 0 });
  const countdown = prepare();
  const active = activate();
  for (const state of [preparing, countdown, active]) {
    assert.strictEqual(reduceWorkout(state, { type: 'start', now: 5000, bodyVisible: true }), state);
    assert.strictEqual(reduceWorkout(state, { type: 'resume', now: 5000, bodyVisible: true }), state);
  }
});

test('finish from active accumulates only active duration and freezes all subsequent events', () => {
  const finished = reduceWorkout(activate(), { type: 'finish', now: 3500 });
  assert.equal(finished.phase, 'finished');
  assert.equal(finished.elapsedMs, 500);
  assert.equal(finished.startedAt, 3000);
  assert.equal(finished.endedAt, 3500);
  assert.equal(finished.activeSince, null);
  assert.equal(finished.countdownUntil, null);
  assert.equal(elapsedWorkoutMs(finished, 100000), 500);
  assert.equal(countdownSeconds(finished, 100000), 0);
  for (const event of [
    { type: 'finish', now: 9000 }, { type: 'pause', now: 9000 }, { type: 'tick', now: 9000 },
    { type: 'start', now: 9000, bodyVisible: true }, { type: 'resume', now: 9000, bodyVisible: true },
    { type: 'pose', now: 9000, bodyVisible: true, angle: 170 },
  ]) assert.strictEqual(reduceWorkout(finished, event), finished);
});

test('finishing a paused workout does not include the paused interval', () => {
  const paused = reduceWorkout(activate(), { type: 'pause', now: 4000 });
  const finished = reduceWorkout(paused, { type: 'finish', now: 9000 });
  assert.equal(finished.phase, 'finished');
  assert.equal(finished.elapsedMs, 1000);
  assert.equal(finished.endedAt, 9000);
});

test('finishing before the first active transition retains a null start and zero duration', () => {
  const preparing = reduceWorkout(createWorkout('session', 'live'), { type: 'start', now: 0 });
  const countdown = prepare();
  const paused = reduceWorkout(countdown, { type: 'pause', now: 1000 });
  for (const state of [preparing, countdown, paused]) {
    const finished = reduceWorkout(state, { type: 'finish', now: 2000 });
    assert.equal(finished.phase, 'finished');
    assert.equal(finished.startedAt, null);
    assert.equal(finished.endedAt, 2000);
    assert.equal(finished.elapsedMs, 0);
  }
});

test('invalid or backward event timestamps leave every state field untouched', () => {
  const state = reduceWorkout(activate(), { type: 'tick', now: 4000 });
  assert.equal(state.lastEventAt, 4000);
  for (const now of [-1, NaN, Infinity, -Infinity, undefined, '5000', 3999]) {
    for (const type of ['start', 'resume', 'tick', 'pause', 'finish', 'pose']) {
      assert.strictEqual(reduceWorkout(state, { type, now, bodyVisible: true, angle: 170 }), state);
    }
  }
  const setup = createWorkout('new', 'live');
  assert.strictEqual(reduceWorkout(setup, { type: 'start', now: NaN, bodyVisible: true }), setup);
  assert.equal(activate(setup).startedAt, 3000);
});

test('equal event timestamps are accepted and do not invent elapsed time', () => {
  let state = reduceWorkout(activate(), { type: 'pause', now: 3000 });
  assert.equal(state.phase, 'paused');
  state = visibleThrough(prepare(state, 3000, 'resume'), 4000, 5000);
  state = reduceWorkout(state, { type: 'tick', now: 6000 });
  state = reduceWorkout(state, { type: 'finish', now: 6000 });
  assert.equal(state.phase, 'finished');
  assert.equal(state.elapsedMs, 0);
  assert.equal(state.startedAt, 3000);
});

test('selectors are pure and return finite nonnegative values for invalid or early now', () => {
  const active = activate();
  const paused = reduceWorkout(active, { type: 'pause', now: 4000 });
  const countdown = visibleThrough(prepare(paused, 5000, 'resume'), 6000, 7000);
  const resumed = reduceWorkout(countdown, { type: 'tick', now: 8000 });
  for (const state of [active, paused, countdown, resumed]) {
    const original = structuredClone(state);
    for (const now of [NaN, Infinity, -Infinity, -1, 0, Number.MAX_VALUE]) {
      const elapsed = elapsedWorkoutMs(state, now);
      const remaining = countdownSeconds(state, now);
      assert.ok(Number.isFinite(elapsed) && elapsed >= 0);
      assert.ok(Number.isFinite(remaining) && remaining >= 0);
    }
    assert.deepEqual(state, original);
  }
  for (const now of [NaN, Infinity, -Infinity, -1]) {
    assert.equal(elapsedWorkoutMs(resumed, now), 1000);
    assert.equal(countdownSeconds(countdown, now), 0);
  }
  assert.equal(elapsedWorkoutMs(resumed, 7999), 1000);
  assert.equal(elapsedWorkoutMs(resumed, 8500), 1500);
});

test('demo mode and identity survive the full lifecycle without changing to live', () => {
  let state = activate(createWorkout('demo-session', 'demo', 7));
  state = completeRep(state, 3000);
  state = reduceWorkout(state, { type: 'pause', now: 4000 });
  state = visibleThrough(prepare(state, 5000, 'resume'), 6000, 7000);
  state = reduceWorkout(state, { type: 'tick', now: 8000 });
  state = reduceWorkout(state, { type: 'finish', now: 9000 });
  assert.equal(state.mode, 'demo');
  assert.equal(state.id, 'demo-session');
  assert.equal(state.target, 7);
  assert.equal(state.counter.reps, 1);
  assert.equal(state.phase, 'finished');
});

test('reducer does not mutate frozen sessions or their existing squat counter', () => {
  let state = createWorkout('session', 'live');
  for (const event of [
    { type: 'start', now: 0 },
    ...[0, 1000, 2000].map(now => ({ type: 'pose', now, bodyVisible: true, angle: 170 })),
    { type: 'tick', now: 3000 },
    { type: 'pose', now: 3000, bodyVisible: true, angle: 170 },
    { type: 'pose', now: 3200, bodyVisible: true, angle: 170 },
    { type: 'pause', now: 3500 }, { type: 'resume', now: 4000 },
    ...[4000, 5000, 6000].map(now => ({ type: 'pose', now, bodyVisible: true, angle: 170 })),
    { type: 'tick', now: 7000 }, { type: 'finish', now: 7500 },
  ]) {
    const original = structuredClone(state);
    Object.freeze(state.counter);
    Object.freeze(state);
    const next = reduceWorkout(state, event);
    assert.notStrictEqual(next, state);
    assert.deepEqual(state, original);
    state = next;
  }
});

test('start ignores cached visibility and waits indefinitely for a new visible pose', () => {
  for (const bodyVisible of [false, true]) {
    const setup = visibleThrough(createWorkout('solo', 'live'), 0);
    let state = reduceWorkout(setup, { type: 'start', now: 100, bodyVisible });
    assert.equal(state.phase, 'preparing');
    assert.equal(state.lastPoseAt, null);
    assert.equal(state.countdownUntil, null);
    for (const now of [1000, 5000, 60000]) {
      state = reduceWorkout(state, { type: 'tick', now });
      state = reduceWorkout(state, { type: 'pose', now, bodyVisible: false, angle: 170 });
      assert.equal(state.phase, 'preparing');
      assert.equal(state.startedAt, null);
      assert.equal(elapsedWorkoutMs(state, now), 0);
      assert.equal(countdownSeconds(state, now), 0);
      assert.equal(state.counter.reps, 0);
    }
    state = visibleThrough(state, 61000);
    assert.equal(state.phase, 'countdown');
    assert.equal(state.countdownUntil, 64000);
  }
});

test('ticks do not refresh pose age: 1000ms is fresh, 1001ms cancels the deadline', () => {
  const countdown = visibleThrough(prepare(), 1000, 2000);
  const fresh = reduceWorkout(countdown, { type: 'tick', now: 3000 });
  assert.equal(fresh.phase, 'active');
  let stale = countdown;
  for (const now of [2250, 2500, 2750, 2999, 3001]) {
    stale = reduceWorkout(stale, { type: 'tick', now });
    assert.equal(stale.lastPoseAt, 2000);
  }
  assert.equal(stale.phase, 'preparing');
  assert.equal(stale.countdownUntil, null);
  assert.equal(stale.startedAt, null);
  assert.equal(stale.elapsedMs, 0);
  const earlyStale = reduceWorkout(prepare(), { type: 'tick', now: 1001 });
  assert.equal(earlyStale.phase, 'preparing');
});

test('a new pose after a gap cannot revive an expired countdown even without timer ticks', () => {
  let state = visibleThrough(prepare(), 1000);
  state = visibleThrough(state, 4000);
  assert.equal(state.phase, 'countdown');
  assert.equal(state.countdownUntil, 7000);
  state = reduceWorkout(state, { type: 'tick', now: 4000 });
  assert.equal(state.phase, 'countdown');
  state = visibleThrough(state, 5000, 6000);
  state = reduceWorkout(state, { type: 'tick', now: 6999 });
  assert.equal(state.phase, 'countdown');
  state = reduceWorkout(state, { type: 'tick', now: 7000 });
  assert.equal(state.phase, 'active');
  assert.equal(state.startedAt, 7000);
});

test('pause cancels preparation and new poses cannot automatically resume after background', () => {
  let state = reduceWorkout(createWorkout('solo', 'live'), { type: 'start', now: 0 });
  state = reduceWorkout(state, { type: 'pause', now: 100 });
  assert.equal(state.phase, 'paused');
  state = visibleThrough(state, 200, 1200, 2200, 3200);
  state = reduceWorkout(state, { type: 'tick', now: 4000 });
  assert.equal(state.phase, 'paused');
  assert.equal(state.startedAt, null);
  state = reduceWorkout(state, { type: 'resume', now: 4100, bodyVisible: false });
  assert.equal(state.phase, 'preparing');
  assert.equal(state.lastPoseAt, null);
});
