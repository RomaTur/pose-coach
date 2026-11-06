const test = require('node:test');
/* global __dirname */
const assert = require('node:assert/strict');
const { registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

// Исполняем настоящий hook и геометрию, заменяя нативные API очередями RN/UI/Worker.
// Этот host-тест не проверяет нативную сериализацию, React-рендерер, камеру или GPU.
let current;
function slot() {
  return current.hooks[current.hookIndex++] ??= {};
}
function memo(factory, deps) {
  const entry = slot();
  if (!entry.deps || deps.length !== entry.deps.length ||
      deps.some((value, index) => !Object.is(value, entry.deps[index]))) {
    entry.value = factory();
    entry.deps = deps;
  }
  return entry.value;
}
const uiId = 73; // Произвольный id тестовой очереди, не предполагаемый id нативного runtime.
const native = {
  react: {
    useCallback: (fn, deps) => memo(() => fn, deps),
    useMemo: memo,
    useEffect: (fn, deps) => { current.effect = memo(() => fn, deps); },
    useRef: value => memo(() => ({ current: value }), []),
    useState: value => memo(() => [value, next => { current.error = next; }], []),
  },
  'react-native-reanimated': {
    useSharedValue(initial) {
      return memo(() => {
        let value = typeof initial === 'function' ? initial() : initial;
        return {
          get: () => value,
          set: next => { value = typeof next === 'function' ? next(value) : next; },
          modify: fn => { value = fn(value); },
        };
      }, []);
    },
    useFrameCallback: fn => { current.expire = fn; },
  },
  'react-native-vision-camera': {
    useFrameOutput: options => options,
  },
  'react-native-vision-camera-resizer': {
    useResizer: () => ({ state: 'ready', resizer: current.resizer }),
  },
  'react-native-worklets': {
    UIRuntimeId: uiId,
    createShareable(id, value) {
      assert.equal(id, uiId);
      return { get isHost() { return current.runtime === 'UI'; }, value };
    },
    scheduleOnUI(fn, ...args) {
      if (!current.bundleMode && current.runtime !== 'RN') {
        throw new Error('scheduleOnUI is RN-only in Legacy Eval');
      }
      current.ui.push(() => fn(...args));
    },
    scheduleOnRuntimeWithId(id, fn, ...args) {
      assert.equal(id, uiId, 'dispatch must target the exported UI runtime id');
      current.ui.push(() => fn(...args));
    },
    scheduleOnRN(fn, ...args) {
      function noBuffers(value) {
        assert.ok(!(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value),
          'pose/image buffers must never travel through RN');
        if (value && typeof value === 'object') Object.values(value).forEach(noBuffers);
      }
      args.forEach(noBuffers);
      current.rn.push(() => fn(...args));
    },
  },
};

// Node исполняет модули проекта обычным способом, без чтения текста файлов и eval.
// Подменяем только нативные импорты и дополняем расширения существующих TS-модулей.
const sourceRoot = pathToFileURL(path.resolve(__dirname, '../src') + path.sep).href;
const key = Symbol.for('pose-dispatch-test-native');
globalThis[key] = native;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (Object.hasOwn(native, specifier)) {
      return { url: `pose-dispatch-test:${specifier}`, shortCircuit: true };
    }
    if (specifier.startsWith('.') && context.parentURL?.startsWith(sourceRoot) &&
        !path.extname(specifier)) return next(`${specifier}.ts`, context);
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('pose-dispatch-test:')) {
      const name = url.slice('pose-dispatch-test:'.length);
      return { format: 'module', shortCircuit: true,
        source: `export const { ${Object.keys(native[name]).join(', ')} } = globalThis[Symbol.for('pose-dispatch-test-native')][${JSON.stringify(name)}];` };
    }
    return next(url, context);
  },
});
let usePosePipeline;
try {
  ({ usePosePipeline } = require('../src/features/pose/inference/usePosePipeline.ts'));
} finally {
  hooks.deregister();
  delete globalThis[key];
}

const empty = { angle: null, bodyVisible: false, modelFps: null, avgMs: null, p95Ms: null };

function setup(t, bundleMode) {
  const h = { bundleMode, runtime: 'RN', ui: [], rn: [], summaries: [], samples: [], releases: [],
    error: null, now: 1000, runs: 0, fail: false, duringInference: null,
    hooks: [], hookIndex: 0 };
  current = h;
  t.mock.method(Date, 'now', () => h.now);
  t.mock.method(performance, 'now', () => h.now);
  const previousDev = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');
  globalThis.__DEV__ = false;
  t.after(() => {
    if (previousDev) Object.defineProperty(globalThis, '__DEV__', previousDev);
    else delete globalThis.__DEV__;
  });
  h.on = (runtime, fn) => {
    const previous = h.runtime;
    h.runtime = runtime;
    try { return fn(); } finally { h.runtime = previous; }
  };
  h.flushUI = () => h.on('UI', () => { while (h.ui.length) h.ui.shift()(); });
  h.flushRN = () => h.on('RN', () => { while (h.rn.length) h.rn.shift()(); });
  h.raw = new Float32Array(51);
  for (let i = 0; i < 51; i += 3) h.raw.set([0.5, 0.5, 0.75], i);
  h.raw.set([0.5, 0.25, 0.75], 0);
  h.raw.set([0.25, 0.5, 0.75], 11 * 3);
  h.raw.set([0.75, 0.5, 0.75], 15 * 3);
  let disposed = false;
  const input = new ArrayBuffer(192 * 192 * 3);
  h.resizer = { resize() {
    disposed = false;
    return {
      getPixelBuffer: () => input,
      dispose() { disposed = true; h.releases.push('resized'); },
    };
  } };
  h.model = { runSync(inputs) {
    assert.equal(disposed, false, 'resized input stays alive during inference');
    assert.equal(inputs[0], input);
    h.runs += 1;
    h.duringInference?.();
    h.now += 4;
    if (h.fail) throw new Error('synthetic inference failure');
    return [h.raw.buffer];
  } };
  h.onSummary = summary => {
    assert.equal(h.runtime, 'RN');
    h.summaries.push(summary);
  };
  h.onSample = (angle, bodyVisible) => { h.samples.push({ angle, bodyVisible }); };
  h.render = (active = true) => {
    h.hookIndex = 0;
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Здесь hook исполняется в тестовом runtime без React-рендерера.
    h.pipeline = usePosePipeline(h.model, active, h.onSummary, h.onSample);
    return h.pipeline.output;
  };
  h.render();
  h.cleanup = h.effect();
  h.flushUI();
  h.flushRN();
  h.summaries.length = 0;
  h.samples.length = 0;
  h.frame = () => h.on('Worker', () => h.pipeline.output.onFrame({
    width: 192, height: 192, orientation: 'up',
    dispose: () => h.releases.push('frame'),
  }));
  h.restart = () => {
    h.on('RN', () => { h.cleanup(); h.cleanup = h.effect(); });
    h.flushUI();
  };
  return h;
}

for (const bundleMode of [false, true]) {
  const mode = bundleMode ? 'Bundle' : 'Legacy Eval';
  // Проверяем контракт нашего hook на границе native API, не имитируем его
  // правила пересоздания output. Реальную CameraSession проверяем на iPhone.
  test(`${mode}: HUD rerenders retain the same frame callback`, t => {
    const h = setup(t, bundleMode);
    const initial = h.pipeline.output.onFrame;
    for (let i = 0; i < 20; i++) {
      h.now += 300;
      h.frame(); h.flushUI(); h.flushRN();
      assert.strictEqual(h.render().onFrame, initial);
    }
    assert.equal(h.runs, 20);
    assert.equal(h.summaries.length, 20);
  });

  test(`${mode}: rerenders retain the same resolution object`, t => {
    const h = setup(t, bundleMode);
    const initial = h.pipeline.output.targetResolution;
    for (let i = 0; i < 20; i++) assert.strictEqual(h.render().targetResolution, initial);
  });

  test(`${mode}: rerenders retain the complete frame output configuration`, t => {
    const h = setup(t, bundleMode);
    const initial = h.pipeline.output;
    for (let i = 0; i < 20; i++) assert.strictEqual(h.render(), initial);
  });

  test(`${mode}: pause and resume reuse callback while gating frame processing`, t => {
    const h = setup(t, bundleMode);
    const initial = h.pipeline.output.onFrame;
    h.cleanup(); h.render(false); h.cleanup = h.effect(); h.flushUI(); h.flushRN();
    assert.strictEqual(h.pipeline.output.onFrame, initial);
    h.frame(); h.flushUI(); h.flushRN();
    assert.equal(h.runs, 0);
    assert.deepEqual(h.releases, ['frame']);
    h.cleanup(); h.render(true); h.cleanup = h.effect(); h.flushUI(); h.flushRN();
    assert.strictEqual(h.pipeline.output.onFrame, initial);
    h.frame(); h.flushUI(); h.flushRN();
    assert.equal(h.runs, 1);
    assert.ok(h.pipeline.pose.get());
  });

  test(`${mode}: changing model refreshes callback and uses the new model`, t => {
    const h = setup(t, bundleMode);
    const initial = h.pipeline.output.onFrame;
    const nextRaw = new Float32Array(h.raw);
    nextRaw[2] = 0.6;
    h.model = { runSync: () => [nextRaw.buffer] };
    h.cleanup(); h.render(); h.cleanup = h.effect(); h.flushUI(); h.flushRN();
    assert.notStrictEqual(h.pipeline.output.onFrame, initial);
    h.frame(); h.flushUI(); h.flushRN();
    assert.equal(h.pipeline.pose.get().points[2], Math.fround(0.6));
    assert.equal(h.runs, 0);
  });

  test(`${mode}: changing resizer refreshes callback and uses the new resizer`, t => {
    const h = setup(t, bundleMode);
    const initial = h.pipeline.output.onFrame;
    const resize = h.resizer.resize;
    let resized = 0;
    h.resizer = { resize(frame) { resized += 1; return resize(frame); } };
    h.render();
    assert.notStrictEqual(h.pipeline.output.onFrame, initial);
    h.frame(); h.flushUI(); h.flushRN();
    assert.equal(resized, 1);
    assert.ok(h.pipeline.pose.get());
    assert.deepEqual(h.releases, ['resized', 'frame']);
  });

  test(`${mode}: every processed pose supplies scalar counter input independently of HUD throttle`, t => {
    const h = setup(t, bundleMode);
    h.frame(); h.flushUI(); h.flushRN();
    h.now += 80;
    h.frame(); h.flushUI(); h.flushRN();
    assert.deepEqual(h.samples, [{ angle: 180, bodyVisible: true }, { angle: 180, bodyVisible: true }]);
    assert.equal(h.summaries.length, 1);
  });

  test(`${mode}: stale or unmounted samples cannot count as a fresh visible pose`, t => {
    const h = setup(t, bundleMode);
    h.frame(); h.flushUI();
    h.now += 401;
    h.flushRN();
    assert.deepEqual(h.samples, [{ angle: null, bodyVisible: false }]);
    h.samples.length = 0;
    h.frame(); h.flushUI(); h.on('RN', h.cleanup); h.flushRN();
    assert.deepEqual(h.samples, []);
  });

  test(`${mode}: worker success publishes an owned pose on UI, only a summary on RN`, t => {
    const h = setup(t, bundleMode);
    assert.doesNotThrow(h.frame);
    assert.deepEqual(h.releases, ['resized', 'frame']);
    assert.equal(h.pipeline.pose.get(), null);
    assert.equal(h.rn.length, 0, 'no RN bounce to deliver the pose');
    h.raw.fill(0); // Модель может переиспользовать память до исполнения UI callback.
    h.flushUI();
    const pose = h.pipeline.pose.get();
    assert.deepEqual([...pose.points.subarray(0, 3)], [0.25, 0.5, 0.75]);
    assert.equal(pose.points.byteLength, 204);
    assert.equal(pose.timestampMs, 1000);
    assert.equal(pose.receivedAt, 1004);
    h.flushRN();
    assert.deepEqual(h.summaries, [{ angle: 180, bodyVisible: true,
      modelFps: null, avgMs: 4, p95Ms: 4 }]);
  });

  test(`${mode}: worker failure clears pose, reports on RN and releases both buffers`, t => {
    const h = setup(t, bundleMode);
    h.frame(); h.flushUI(); h.flushRN();
    h.now += 100;
    h.fail = true;
    assert.doesNotThrow(h.frame);
    assert.equal(h.error, null);
    h.flushUI();
    assert.equal(h.pipeline.pose.get(), null);
    h.flushRN();
    assert.equal(typeof h.error, 'string');
    assert.deepEqual(h.summaries.at(-1), empty);
    h.now += 100;
    h.frame(); // После ошибки текущее поколение останавливается.
    assert.equal(h.runs, 2);
    assert.deepEqual(h.releases, ['resized', 'frame', 'resized', 'frame', 'frame']);
  });

  for (const fail of [false, true]) {
    test(`${mode}: delayed ${fail ? 'error' : 'pose'} cannot commit across a reset epoch`, t => {
      const h = setup(t, bundleMode);
      h.fail = fail;
      h.duringInference = h.restart; // UI сбрасывается, пока старый worker занят.
      assert.doesNotThrow(h.frame);
      h.flushUI(); h.flushRN();
      assert.equal(h.pipeline.pose.get(), null);
      assert.equal(h.error, null);
      assert.ok(h.summaries.every(summary => summary.bodyVisible === false));
      h.fail = false;
      h.duringInference = null;
      h.frame(); h.flushUI(); h.flushRN();
      assert.ok(h.pipeline.pose.get());
      assert.equal(h.summaries.at(-1).bodyVisible, true);
      assert.deepEqual(h.releases, ['resized', 'frame', 'resized', 'frame']);
    });

    test(`${mode}: queued RN ${fail ? 'error' : 'summary'} is ignored after unmount`, t => {
      const h = setup(t, bundleMode);
      h.fail = fail;
      h.frame(); h.flushUI();
      h.on('RN', h.cleanup); // Поколение RN меняется раньше исполнения UI cleanup.
      h.flushRN();
      assert.equal(h.error, null);
      assert.deepEqual(h.summaries, []);
      h.flushUI(); h.flushRN();
      assert.equal(h.pipeline.pose.get(), null);
      assert.deepEqual(h.summaries, [empty]);
    });
  }

  test(`${mode}: dispatch retains processing/summary limits and stale-pose expiry`, t => {
    const h = setup(t, bundleMode);
    h.frame(); h.flushUI(); h.flushRN();
    h.frame(); // До истечения 1000/15 мс кадр освобождается без resize/inference.
    assert.equal(h.runs, 1);
    assert.deepEqual(h.releases, ['resized', 'frame', 'frame']);
    h.now += 70;
    h.frame(); h.flushUI(); h.flushRN();
    assert.equal(h.runs, 2);
    assert.equal(h.summaries.length, 1); // До истечения 250 мс новой сводки нет.
    h.now += 400;
    h.on('UI', h.expire);
    assert.ok(h.pipeline.pose.get());
    h.now += 1;
    h.on('UI', h.expire); h.flushRN();
    assert.equal(h.pipeline.pose.get(), null);
    assert.deepEqual(h.summaries.at(-1), empty);
    h.frame(); h.flushUI(); h.flushRN();
    assert.equal(h.summaries.at(-1).modelFps, null, 'expiry clears the metrics window');
  });
}
