const { test } = require('node:test');
const assert = require('node:assert/strict');
const { demoPoseAt, DEMO_WIDTH, DEMO_HEIGHT } = require('../src/features/demo/demoPose.ts');
const { getKneeAngle, isBodyVisible } = require('../src/features/pose/model/poseGeometry.ts');
const { createSquatState, updateSquat } = require('../src/features/coach/model/squatCounter.ts');

test('synthetic pose is visible and contains 17 finite confidence-labelled landmarks', () => {
  for (let ms = 0; ms < 4000; ms += 100) {
    const points = demoPoseAt(ms);
    assert.equal(points.length, 51);
    assert.ok(points.every(Number.isFinite));
    assert.equal(isBodyVisible(points), true);
  }
});

test('synthetic motion exercises real angle geometry and counter deterministically', () => {
  let state = createSquatState();
  for (let ms = 0; ms < 12000; ms += 80) {
    const angle = getKneeAngle(demoPoseAt(ms), DEMO_WIDTH, DEMO_HEIGHT);
    assert.notEqual(angle, null);
    state = updateSquat(state, angle, ms);
  }
  assert.equal(state.reps, 3);
});

test('replay repeats exactly and does not share mutable arrays', () => {
  const first = demoPoseAt(0);
  assert.deepEqual(first, demoPoseAt(4000));
  const separate = demoPoseAt(0);
  first[0] = -1;
  assert.notEqual(separate[0], -1);
});
