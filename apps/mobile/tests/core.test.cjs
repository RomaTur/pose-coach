const test = require('node:test');
const assert = require('node:assert/strict');
const { decodePose } = require('../src/features/pose/model/decodePose.ts');
const { frameToScreen } = require('../src/features/pose/overlay/frameToScreen.ts');
const {
  createFrameMetrics,
  recordFrame,
  summarizeFrames,
} = require('../src/features/metrics/frameMetrics.ts');
const {
  createSquatState,
  updateSquat,
} = require('../src/features/coach/model/squatCounter.ts');

function poseOutput() {
  const output = new Float32Array(51);
  for (let i = 0; i < 51; i += 3) {
    output[i] = 0.25;
    output[i + 1] = 0.75;
    output[i + 2] = 0.5;
  }
  return output;
}

test('decode reorders every y,x,score triple into the existing target', () => {
  const output = poseOutput();
  output.set([0.125, 0.875, 1], 48);
  const original = output.slice();
  const target = new Float32Array(51).fill(-1);
  assert.equal(decodePose(output, target), true);
  for (let i = 0; i < 48; i += 3) {
    assert.deepEqual([...target.subarray(i, i + 3)], [0.75, 0.25, 0.5]);
  }
  assert.deepEqual([...target.subarray(48)], [0.875, 0.125, 1]);
  assert.deepEqual(output, original);
});

test('decode supports in-place conversion without overwriting y', () => {
  const buffer = poseOutput();
  assert.equal(decodePose(buffer, buffer), true);
  assert.deepEqual([...buffer.subarray(0, 3)], [0.75, 0.25, 0.5]);
});

test('decode handles overlapping views without overwriting unread triples', () => {
  for (const [sourceOffset, targetOffset] of [[0, 1], [0, 2], [0, 3], [1, 0], [2, 0], [3, 0]]) {
    const buffer = new ArrayBuffer(54 * Float32Array.BYTES_PER_ELEMENT);
    const output = new Float32Array(buffer, sourceOffset * 4, 51);
    const target = new Float32Array(buffer, targetOffset * 4, 51);
    for (let i = 0; i < 51; i += 1) output[i] = i;
    assert.equal(decodePose(output, target), true);
    assert.deepEqual([...target.subarray(0, 9)], [1, 0, 2, 4, 3, 5, 7, 6, 8]);
    assert.deepEqual([...target.subarray(48)], [49, 48, 50]);
  }
});

test('decode rejects wrong input and target lengths without partial writes', () => {
  for (const [inputLength, targetLength] of [[50, 51], [52, 51], [51, 50], [51, 52]]) {
    const target = new Float32Array(targetLength).fill(-1);
    assert.equal(decodePose(new Float32Array(inputLength), target), false);
    assert.deepEqual(target, new Float32Array(targetLength).fill(-1));
  }
});

test('decode validates the whole pose before writing any target value', () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    for (const index of [0, 25, 50]) {
      const output = poseOutput();
      output[index] = invalid;
      const target = new Float32Array(51).fill(-1);
      assert.equal(decodePose(output, target), false);
      assert.deepEqual(target, new Float32Array(51).fill(-1));
    }
  }
});

test('cover maps normalized coordinates with matching aspect ratios', () => {
  assert.deepEqual(frameToScreen(0.25, 0.75, 200, 400, 100, 200, false), { x: 25, y: 150 });
});

test('mirror flips an asymmetric x coordinate exactly once', () => {
  assert.deepEqual(frameToScreen(0.25, 0.75, 200, 400, 100, 200, true), { x: 75, y: 150 });
});

test('cover crops horizontal overflow before mirroring', () => {
  assert.deepEqual(frameToScreen(0.25, 0.75, 400, 200, 100, 100, false), { x: 0, y: 75 });
  assert.deepEqual(frameToScreen(0.25, 0.75, 400, 200, 100, 100, true), { x: 100, y: 75 });
  assert.deepEqual(frameToScreen(0, 0.5, 400, 200, 100, 100, false), { x: -50, y: 50 });
});

test('cover crops vertical overflow without clamping coordinates', () => {
  assert.deepEqual(frameToScreen(0.25, 0, 200, 400, 100, 100, false), { x: 25, y: -50 });
  assert.deepEqual(frameToScreen(0.25, 1, 200, 400, 100, 100, true), { x: 75, y: 150 });
});

test('empty metrics have no invented latency or FPS', () => {
  assert.deepEqual(summarizeFrames(createFrameMetrics()), {
    count: 0, avgMs: null, p95Ms: null, fps: null,
  });
});

test('one accepted frame reports latency but no FPS; zero duration is valid', () => {
  const metrics = createFrameMetrics();
  recordFrame(metrics, 0, 0);
  assert.deepEqual(summarizeFrames(metrics), { count: 1, avgMs: 0, p95Ms: 0, fps: null });
});

test('metrics use nearest-rank p95 and elapsed intervals, not sample count, for FPS', () => {
  const metrics = createFrameMetrics(20);
  for (let i = 0; i < 20; i += 1) recordFrame(metrics, i * 50, 20 - i);
  assert.deepEqual(summarizeFrames(metrics), { count: 20, avgMs: 10.5, p95Ms: 19, fps: 20 });
});

test('mean stays finite for accepted maximum durations and zero after rollover', () => {
  const metrics = createFrameMetrics(2);
  recordFrame(metrics, 0, Number.MAX_VALUE);
  recordFrame(metrics, 100, Number.MAX_VALUE);
  assert.deepEqual(summarizeFrames(metrics), {
    count: 2, avgMs: Number.MAX_VALUE, p95Ms: Number.MAX_VALUE, fps: 10,
  });
  recordFrame(metrics, 200, 0);
  assert.deepEqual(summarizeFrames(metrics), {
    count: 2, avgMs: Number.MAX_VALUE / 2, p95Ms: Number.MAX_VALUE, fps: 10,
  });
  recordFrame(metrics, 300, 0);
  assert.deepEqual(summarizeFrames(metrics), { count: 2, avgMs: 0, p95Ms: 0, fps: 10 });
  recordFrame(metrics, 400, Number.MAX_VALUE);
  assert.deepEqual(summarizeFrames(metrics), {
    count: 2, avgMs: Number.MAX_VALUE / 2, p95Ms: Number.MAX_VALUE, fps: 10,
  });
});

test('ring rollover drops old latency and timestamps and summary does not reorder the ring', () => {
  const metrics = createFrameMetrics(3);
  recordFrame(metrics, 0, 100);
  recordFrame(metrics, 50, 30);
  recordFrame(metrics, 100, 10);
  const { avgMs, ...rest } = summarizeFrames(metrics);
  // Порядок вычислений может менять последний разряд дробного среднего.
  assert.ok(Math.abs(avgMs - 140 / 3) <= Number.EPSILON * (140 / 3));
  assert.deepEqual(rest, { count: 3, p95Ms: 100, fps: 20 });
  recordFrame(metrics, 200, 20);
  assert.deepEqual(summarizeFrames(metrics), { count: 3, avgMs: 20, p95Ms: 30, fps: 2000 / 150 });
  recordFrame(metrics, 300, 60);
  assert.deepEqual(summarizeFrames(metrics), { count: 3, avgMs: 30, p95Ms: 60, fps: 10 });
});

test('default metrics window retains only the latest 120 samples', () => {
  const metrics = createFrameMetrics();
  for (let i = 0; i <= 120; i += 1) recordFrame(metrics, i * 10, i === 0 ? 999 : 5);
  assert.deepEqual(summarizeFrames(metrics), { count: 120, avgMs: 5, p95Ms: 5, fps: 100 });
});

test('capacity one never invents FPS using an overwritten timestamp', () => {
  const metrics = createFrameMetrics(1);
  recordFrame(metrics, 0, 8);
  recordFrame(metrics, 100, 12);
  assert.deepEqual(summarizeFrames(metrics), { count: 1, avgMs: 12, p95Ms: 12, fps: null });
});

test('invalid capacities are rejected instead of producing a broken ring', () => {
  for (const capacity of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => createFrameMetrics(capacity), RangeError);
  }
});

test('invalid, duplicate and backwards timestamps leave the entire metrics window unchanged', () => {
  const metrics = createFrameMetrics(3);
  recordFrame(metrics, 100, 10);
  recordFrame(metrics, 200, 20);
  for (const timestamp of [NaN, Infinity, -Infinity, -1, 200, 150, 0]) {
    recordFrame(metrics, timestamp, 999);
    assert.deepEqual(summarizeFrames(metrics), { count: 2, avgMs: 15, p95Ms: 20, fps: 10 });
  }
  recordFrame(metrics, 300, 30);
  assert.deepEqual(summarizeFrames(metrics), { count: 3, avgMs: 20, p95Ms: 30, fps: 10 });
});

test('invalid inference durations do not advance the clock or enter the ring', () => {
  const metrics = createFrameMetrics(3);
  recordFrame(metrics, 0, 10);
  for (const inferenceMs of [-1, NaN, Infinity, -Infinity]) recordFrame(metrics, 200, inferenceMs);
  assert.deepEqual(summarizeFrames(metrics), { count: 1, avgMs: 10, p95Ms: 10, fps: null });
  recordFrame(metrics, 100, 20);
  assert.deepEqual(summarizeFrames(metrics), { count: 2, avgMs: 15, p95Ms: 20, fps: 10 });
});

test('invalid first timestamp cannot poison subsequent FPS', () => {
  const metrics = createFrameMetrics();
  for (const timestamp of [NaN, Infinity, -Infinity, -1]) recordFrame(metrics, timestamp, 8);
  recordFrame(metrics, 0, 10);
  recordFrame(metrics, 100, 20);
  assert.deepEqual(summarizeFrames(metrics), { count: 2, avgMs: 15, p95Ms: 20, fps: 10 });
});

test('an unrepresentably small elapsed interval cannot produce infinite FPS', () => {
  const metrics = createFrameMetrics();
  recordFrame(metrics, 0, 10);
  recordFrame(metrics, Number.MIN_VALUE, 999);
  assert.deepEqual(summarizeFrames(metrics), { count: 1, avgMs: 10, p95Ms: 10, fps: null });
  recordFrame(metrics, 100, 20);
  assert.deepEqual(summarizeFrames(metrics), { count: 2, avgMs: 15, p95Ms: 20, fps: 10 });
});

function feed(samples, initial = createSquatState()) {
  return samples.reduce((state, [angle, timestamp]) => updateSquat(state, angle, timestamp), initial);
}

test('squat requires stable standing, down and standing for a complete repetition', () => {
  let state = feed([[160, 0], [160, 200], [100, 300], [100, 499]]);
  assert.equal(state.phase, 'ready');
  assert.equal(state.reps, 0);
  state = updateSquat(state, 100, 500);
  assert.equal(state.phase, 'down');
  state = feed([[160, 600], [160, 799]], state);
  assert.equal(state.reps, 0);
  state = updateSquat(state, 160, 800);
  assert.equal(state.phase, 'ready');
  assert.equal(state.reps, 1);
  state = feed([[180, 900], [180, 1100]], state);
  assert.equal(state.reps, 1);
  state = feed([[90, 1200], [90, 1400], [170, 1500], [170, 1700]], state);
  assert.equal(state.reps, 2);
});

test('starting low cannot count a squat until an initial stable standing pose', () => {
  const state = feed([[90, 0], [90, 200], [170, 300], [170, 500]]);
  assert.equal(state.phase, 'ready');
  assert.equal(state.reps, 0);
});

test('standing for less than 200 ms does not arm the squat counter', () => {
  const state = feed([[170, 0], [170, 199], [90, 200], [90, 400], [170, 500], [170, 700]]);
  assert.equal(state.reps, 0);
});

test('threshold jitter resets candidate dwell instead of accumulating disjoint time', () => {
  let state = feed([[170, 0], [170, 200], [100, 300], [101, 450], [100, 500], [100, 650]]);
  assert.equal(state.phase, 'ready');
  state = updateSquat(state, 100, 700);
  assert.equal(state.phase, 'down');
  state = feed([[160, 800], [159, 950], [160, 1000], [160, 1150]], state);
  assert.equal(state.reps, 0);
  state = updateSquat(state, 160, 1200);
  assert.equal(state.reps, 1);
});

test('a partial squat does not count; a stable low pose alone does not count', () => {
  const partial = feed([[170, 0], [170, 200], [110, 300], [110, 500], [170, 600], [170, 800]]);
  assert.equal(partial.reps, 0);
  const down = feed([[170, 0], [170, 200], [90, 300], [90, 500], [90, 800]]);
  assert.equal(down.phase, 'down');
  assert.equal(down.reps, 0);
});

test('invalid pose aborts the unfinished repetition but preserves completed reps', () => {
  const completed = feed([[170, 0], [170, 200], [90, 300], [90, 500], [170, 600], [170, 800]]);
  const down = feed([[90, 900], [90, 1100]], completed);
  for (const invalid of [null, NaN, Infinity, -Infinity, -1, 181]) {
    let state = updateSquat(down, invalid, 1200);
    assert.equal(state.phase, 'ready');
    assert.equal(state.reps, 1);
    state = feed([[90, 1300], [90, 1500], [170, 1600], [170, 1800]], state);
    assert.equal(state.reps, 1);
  }
});

test('pose loss cancels the initial standing dwell', () => {
  const state = feed([[170, 0], [null, 150], [170, 200], [170, 350], [90, 400], [90, 600], [170, 700], [170, 900]]);
  assert.equal(state.reps, 0);
});

test('a frame gap above 1000 ms aborts a pending squat', () => {
  const state = feed([[170, 0], [170, 200], [90, 300], [90, 500], [170, 1501], [170, 1701]]);
  assert.equal(state.phase, 'ready');
  assert.equal(state.reps, 0);
});

test('a gap of exactly 1000 ms is allowed', () => {
  const state = feed([[170, 0], [170, 200], [90, 300], [90, 500], [170, 1500], [170, 1700]]);
  assert.equal(state.reps, 1);
});

test('updateSquat returns a fresh state and does not mutate its input', () => {
  const state = createSquatState();
  const original = structuredClone(state);
  Object.freeze(state);
  const next = updateSquat(state, 170, 0);
  assert.notStrictEqual(next, state);
  assert.deepEqual(state, original);
});
