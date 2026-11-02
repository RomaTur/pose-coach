const test = require('node:test');
const assert = require('node:assert/strict');
const {
  unletterboxPose,
  getKneeAngle,
  isBodyVisible,
} = require('../src/features/pose/model/poseGeometry.ts');

function centeredPose() {
  const pose = new Float32Array(51);
  for (let i = 0; i < 51; i += 3) pose.set([0.5, 0.5, 0.75], i);
  return pose;
}

function setLeg(pose, side, points, scores = [1, 1, 1]) {
  const hip = side === 'left' ? 11 : 12;
  points.forEach(([x, y], index) => pose.set([x, y, scores[index]], (hip + index * 2) * 3));
  return pose;
}

const straight = [[0.5, 0.25], [0.5, 0.5], [0.5, 0.75]];
const rightAngle = [[0.25, 0.5], [0.5, 0.5], [0.5, 0.75]];

function closeTo(actual, expected, tolerance = 1e-6) {
  assert.equal(typeof actual, 'number');
  assert.ok(Number.isFinite(actual));
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

test('unletterbox removes centered portrait padding in place, including source boundaries', () => {
  const pose = centeredPose();
  pose.set([0.375, 0.25, 0.75], 0);
  pose.set([0.25, 0, 1], 3);
  pose.set([0.75, 1, 1], 48);
  assert.equal(unletterboxPose(pose, 400, 800), true);
  assert.deepEqual([...pose.subarray(0, 6)], [0.25, 0.25, 0.75, 0, 0, 1]);
  assert.deepEqual([...pose.subarray(48)], [1, 1, 1]);
});

test('unletterbox removes centered landscape padding', () => {
  const pose = centeredPose();
  pose.set([0.25, 0.375, 0.75], 0);
  pose.set([0, 0.25, 1], 3);
  pose.set([1, 0.75, 1], 48);
  assert.equal(unletterboxPose(pose, 800, 400), true);
  assert.deepEqual([...pose.subarray(0, 6)], [0.25, 0.25, 0.75, 0, 0, 1]);
  assert.deepEqual([...pose.subarray(48)], [1, 1, 1]);
});

test('square contain preserves all in-frame coordinates and scores', () => {
  const pose = centeredPose();
  pose.set([0, 1, 0.5], 0);
  pose.set([1, 0, 1], 48);
  const original = pose.slice();
  assert.equal(unletterboxPose(pose, 192, 192), true);
  assert.deepEqual(pose, original);
});

test('padding points lose confidence without being clamped to a source edge', () => {
  for (const [width, height, axis] of [[400, 800, 0], [800, 400, 1]]) {
    const pose = centeredPose();
    pose[axis] = 0.125;
    pose[axis + 3] = 0.875;
    assert.equal(unletterboxPose(pose, width, height), true);
    assert.equal(pose[axis], -0.25);
    assert.equal(pose[axis + 3], 1.25);
    assert.equal(pose[2], 0);
    assert.equal(pose[5], 0);
    assert.equal(pose[8], 0.75);
  }
});

test('coordinates outside a square source also lose confidence without clamping', () => {
  const pose = centeredPose();
  pose.set([-0.25, 1.25, 1]);
  assert.equal(unletterboxPose(pose, 192, 192), true);
  assert.deepEqual([...pose.subarray(0, 3)], [-0.25, 1.25, 0]);
});

test('unletterbox rejects wrong shape atomically', () => {
  for (const length of [0, 50, 52]) {
    const pose = new Float32Array(length).fill(0.25);
    const original = pose.slice();
    assert.equal(unletterboxPose(pose, 400, 800), false);
    assert.deepEqual(pose, original);
  }
});

test('unletterbox validates every entry before mutating any point', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    for (const index of [0, 25, 50]) {
      const pose = centeredPose();
      pose[0] = 0.375;
      pose[index] = value;
      const original = pose.slice();
      assert.equal(unletterboxPose(pose, 400, 800), false);
      assert.deepEqual(pose, original);
    }
  }
});

test('unletterbox rejects invalid source dimensions atomically', () => {
  for (const value of [0, -1, NaN, Infinity, -Infinity]) {
    for (const [width, height] of [[value, 800], [400, value]]) {
      const pose = centeredPose();
      const original = pose.slice();
      assert.equal(unletterboxPose(pose, width, height), false);
      assert.deepEqual(pose, original);
    }
  }
});

test('unletterbox rejects unrepresentable inverse coordinates without corrupting the buffer', () => {
  for (const [width, height] of [[Number.MIN_VALUE, Number.MAX_VALUE], [1, 1e40]]) {
    const pose = centeredPose();
    pose[48] = 0.25;
    const original = pose.slice();
    assert.equal(unletterboxPose(pose, width, height), false);
    assert.deepEqual(pose, original);
  }
});

test('knee angle measures a straight leg without mutating the pose', () => {
  const pose = setLeg(new Float32Array(51), 'left', straight);
  const original = pose.slice();
  closeTo(getKneeAngle(pose, 400, 800), 180);
  assert.deepEqual(pose, original);
});

test('knee angle measures a right angle using the right COCO leg indices', () => {
  const pose = setLeg(new Float32Array(51), 'right', rightAngle);
  closeTo(getKneeAngle(pose, 400, 800), 90);
});

test('coincident directions form zero degrees, not a degenerate segment', () => {
  const pose = setLeg(new Float32Array(51), 'left', [[0.5, 0.25], [0.5, 0.5], [0.5, 0]]);
  closeTo(getKneeAngle(pose, 400, 800), 0);
});

test('knee angle applies pixel aspect ratio instead of measuring in a normalized square', () => {
  const pose = setLeg(new Float32Array(51), 'left', [[0, 0], [0.5, 0.5], [1, 0]]);
  closeTo(getKneeAngle(pose, 200, 100), 126.86989764584402);
  closeTo(getKneeAngle(pose, 100, 200), 53.13010235415598);
});

test('knee angle chooses the larger minimum joint confidence rather than the average', () => {
  const pose = new Float32Array(51);
  setLeg(pose, 'left', straight, [1, 1, 0.5]);
  setLeg(pose, 'right', rightAngle, [0.75, 0.75, 0.75]);
  closeTo(getKneeAngle(pose, 400, 800), 90);
});

test('knee angle chooses the left leg on equal minimum confidence', () => {
  const pose = new Float32Array(51);
  setLeg(pose, 'left', straight, [0.75, 0.75, 0.75]);
  setLeg(pose, 'right', rightAngle, [0.75, 1, 1]);
  closeTo(getKneeAngle(pose, 400, 800), 180);
});

test('each joint must meet the confidence threshold, with an inclusive boundary', () => {
  for (let joint = 0; joint < 3; joint += 1) {
    const scores = [1, 1, 1];
    scores[joint] = 0.25;
    const pose = setLeg(new Float32Array(51), 'left', straight, scores);
    assert.equal(getKneeAngle(pose, 400, 800), null);
    closeTo(getKneeAngle(pose, 400, 800, 0.25), 180);
  }
  const boundary = setLeg(new Float32Array(51), 'left', straight, [0.4, 0.4, 0.4]);
  closeTo(getKneeAngle(boundary, 400, 800), 180);
});

test('out-of-frame joints disqualify a side even when its confidence is higher', () => {
  for (const joint of [11, 13, 15]) {
    for (const offset of [0, 1]) {
      for (const value of [-0.125, 1.125]) {
        const pose = new Float32Array(51);
        setLeg(pose, 'left', straight);
        setLeg(pose, 'right', rightAngle, [0.75, 0.75, 0.75]);
        pose[joint * 3 + offset] = value;
        closeTo(getKneeAngle(pose, 400, 800), 90);
      }
    }
  }
});

test('knee angle rejects absent legs and either zero-length segment', () => {
  assert.equal(getKneeAngle(new Float32Array(51), 400, 800), null);
  for (const points of [
    [[0.5, 0.5], [0.5, 0.5], [0.5, 0.75]],
    [[0.5, 0.25], [0.5, 0.5], [0.5, 0.5]],
  ]) {
    const pose = setLeg(new Float32Array(51), 'left', points);
    assert.equal(getKneeAngle(pose, 400, 800), null);
  }
});

test('knee angle rejects invalid shape, nonfinite entries, dimensions and thresholds', () => {
  for (const length of [0, 50, 52]) assert.equal(getKneeAngle(new Float32Array(length), 400, 800), null);
  for (const value of [NaN, Infinity, -Infinity]) {
    for (const index of [0, 25, 50]) {
      const pose = setLeg(new Float32Array(51), 'left', straight);
      pose[index] = value;
      assert.equal(getKneeAngle(pose, 400, 800), null);
    }
  }
  const pose = setLeg(new Float32Array(51), 'left', straight);
  for (const value of [0, -1, NaN, Infinity, -Infinity]) {
    assert.equal(getKneeAngle(pose, value, 800), null);
    assert.equal(getKneeAngle(pose, 400, value), null);
  }
  for (const threshold of [-0.1, 1.1, NaN, Infinity, -Infinity]) {
    assert.equal(getKneeAngle(pose, 400, 800, threshold), null);
  }
});

test('near-collinear segments return a finite angle within acos bounds', () => {
  const pose = setLeg(new Float32Array(51), 'left', [[0.625, 0.625], [0.5, 0.5], [0.75, 0.75]]);
  const angle = getKneeAngle(pose, 400, 800);
  closeTo(angle, 0, 1e-5);
  assert.ok(angle >= 0 && angle <= 180);
});

const requiredBodyJoints = [5, 6, 11, 12, 13, 14, 15, 16];

function visibleBody() {
  const pose = new Float32Array(51);
  for (const joint of requiredBodyJoints) pose.set([0.5, 0.5, 0.75], joint * 3);
  return pose;
}

test('body visibility accepts all eight required joints without mutating the pose', () => {
  const pose = visibleBody();
  const original = pose.slice();
  assert.equal(isBodyVisible(pose), true);
  assert.deepEqual(pose, original);
});

test('every required body joint must meet the confidence threshold', () => {
  for (const joint of requiredBodyJoints) {
    const pose = visibleBody();
    pose[joint * 3 + 2] = 0.25;
    const original = pose.slice();
    assert.equal(isBodyVisible(pose), false);
    assert.deepEqual(pose, original);
  }
});

test('any required body joint outside either image axis rejects visibility', () => {
  for (const joint of requiredBodyJoints) {
    for (const axis of [0, 1]) {
      for (const coordinate of [-0.125, 1.125]) {
        const pose = visibleBody();
        pose[joint * 3 + axis] = coordinate;
        const original = pose.slice();
        assert.equal(isBodyVisible(pose), false);
        assert.deepEqual(pose, original);
      }
    }
  }
});

test('missing optional face, elbow and wrist points do not prevent body visibility', () => {
  const pose = visibleBody();
  for (const joint of [0, 1, 2, 3, 4, 7, 8, 9, 10]) pose.set([-1, 2, 0], joint * 3);
  assert.equal(isBodyVisible(pose), true);
});

test('body visibility includes exact coordinate and confidence boundaries', () => {
  for (const threshold of [0, 0.5, 1]) {
    const pose = visibleBody();
    for (const joint of requiredBodyJoints) pose.set([joint % 2, 1 - joint % 2, threshold], joint * 3);
    assert.equal(isBodyVisible(pose, threshold), true);
  }
  const pose = visibleBody();
  const confidence = Math.fround(0.4);
  for (const joint of requiredBodyJoints) pose[joint * 3 + 2] = confidence;
  assert.equal(isBodyVisible(pose), true);
  assert.equal(isBodyVisible(pose, confidence), true);
  assert.equal(isBodyVisible(pose, confidence + Number.EPSILON), false);
});

test('body visibility rejects invalid shape, any nonfinite entry and invalid thresholds', () => {
  for (const length of [0, 50, 52]) assert.equal(isBodyVisible(new Float32Array(length)), false);
  for (const value of [NaN, Infinity, -Infinity]) {
    for (let index = 0; index < 51; index += 1) {
      const pose = visibleBody();
      pose[index] = value;
      assert.equal(isBodyVisible(pose), false);
    }
  }
  for (const threshold of [-1, 1.01, NaN, Infinity, -Infinity]) {
    assert.equal(isBodyVisible(visibleBody(), threshold), false);
  }
});
