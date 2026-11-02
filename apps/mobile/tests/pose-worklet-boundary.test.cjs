/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { execFileSync } = require('node:child_process');
const { createRequire, stripTypeScriptTypes } = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Обычный checkout не требует внешних инструментов чтения исходников.
// В агентной среде явно задаётся проверяющий reader; его отказ не обходим.
const mobile = path.resolve(__dirname, '..');
const fromExpo = createRequire(require.resolve('expo/package.json'));
const presetPath = fromExpo.resolve('babel-preset-expo');
const fromPreset = createRequire(presetPath);
const babel = fromPreset('@babel/core');
const commonjs = fromPreset.resolve('@babel/plugin-transform-modules-commonjs');
const workletsRoot = path.dirname(require.resolve('react-native-worklets/package.json'));
const sourceCache = new Map();
const codeCache = new Map();
const uiId = 73;
const pipelinePath = path.join(mobile, 'src/features/pose/inference/usePosePipeline.ts');
const appFiles = new Set([
  pipelinePath,
  path.join(mobile, 'src/features/metrics/frameMetrics.ts'),
  path.join(mobile, 'src/features/pose/model/decodePose.ts'),
  path.join(mobile, 'src/features/pose/model/poseGeometry.ts'),
]);
const dependencyFiles = new Set([
  'workletFunction.ts', 'memory/valueUnpacker.native.ts', 'memory/serializable.native.ts',
  'memory/shareable.native.ts', 'memory/shareableHostUnpacker.native.ts',
]);

function safeSource(filename) {
  if (!sourceCache.has(filename)) {
    const reader = process.env.POSE_COACH_TEST_SOURCE_READER;
    const source = reader === undefined
      ? fs.readFileSync(filename, 'utf8')
      : execFileSync('python3', [reader, '--explain', filename], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024,
      });
    sourceCache.set(filename, source);
  }
  return sourceCache.get(filename);
}

function transform(source, options) {
  // Babel повторно читает исходник для source map: возвращаем уже проверенный текст.
  const read = fs.readFileSync;
  fs.readFileSync = (filename, encoding) => filename === options.filename
    ? (encoding ? source : Buffer.from(source)) : read(filename, encoding);
  try { return babel.transformSync(source, options); } finally { fs.readFileSync = read; }
}

function compile(filename, supportsReactCompiler, application) {
  const key = `${filename}:${supportsReactCompiler}:${application}`;
  if (!codeCache.has(key)) {
    const source = safeSource(filename);
    codeCache.set(key, transform(application ? source : stripTypeScriptTypes(source), {
      filename, cwd: mobile, configFile: false, babelrc: false,
      presets: application ? [presetPath] : [],
      plugins: application ? [] : [commonjs],
      caller: { name: 'metro', platform: 'ios', engine: 'hermes', bundler: 'metro',
        isDev: true, isServer: false, supportsStaticESM: false, supportsReactCompiler },
    }).code);
  }
  return codeCache.get(key);
}

function evaluate(code, context, imports, filename) {
  const module = { exports: {} };
  vm.runInContext(`(function(require, module, exports) { ${code}\n})`, context,
    { filename })(imports, module, module.exports);
  return module.exports;
}

function setup(supportsReactCompiler) {
  const h = { runtime: 'RN', now: 1000, ui: [], rn: [], samples: [], summaries: [],
    releases: [], runs: 0, fail: false, error: null, dispatches: 0, uiExecutions: 0 };
  const runtimes = {};
  const hostFunctions = new WeakSet();
  const hostResources = new WeakMap();
  const ref = (kind, value) => ({ __serializableRef: true, kind, value });
  const host = value => new Proxy(value, {
    has: (target, key) => key === 'REANIMATED_MAGIC_KEY' || Reflect.has(target, key),
  });
  h.on = (name, fn) => {
    const previous = h.runtime;
    h.runtime = name;
    try { return fn(); } finally { h.runtime = previous; }
  };

  // Настоящие JS serializer/unpacker; только C++/JSI transport и native HostObjects — doubles.
  // Не переносим hash/closure на bound-функции и не восстанавливаем их по скрытой таблице.
  function unpack(packet, runtime) {
    if (packet?.__remoteFunction) return packet;
    assert.ok(packet?.__serializableRef, 'transport expects a serialized reference');
    const { kind, value } = packet;
    if (kind === 'scalar' || kind === 'hostFunction') return value;
    if (kind === 'remote') return { __remoteFunction: packet };
    if (kind === 'buffer') return value.slice(0);
    if (kind === 'error') return Object.assign(new Error(value.message), value);
    if (kind === 'view') return new globalThis[value.type](value.buffer.slice(0), value.offset, value.length);
    if (kind === 'array') return value.map(item => unpack(item, runtime));
    if (kind === 'host') {
      const resource = hostResources.get(value);
      if (!resource) return value;
      if (runtime.name !== 'UI') return value;
      if (!resource.ui) {
        resource.ui = runtime.context.__shareableHostUnpacker(unpack(resource.initial, runtime));
      }
      return resource.ui;
    }
    const object = vm.runInContext('({})', runtime.context);
    for (const [key, item] of Object.entries(value)) object[key] = unpack(item, runtime);
    if (kind === 'worklet') {
      const fn = runtime.context.__valueUnpacker(object);
      assert.equal(fn.__workletHash, undefined, 'installed unpacker returns a bound function without metadata');
      return fn;
    }
    assert.equal(kind, 'object');
    return object;
  }

  function makeRuntime(name) {
    const runtime = { name };
    const scalar = value => ref('scalar', value);
    const bridge = {
      createSerializableString: scalar, createSerializableNumber: scalar,
      createSerializableBoolean: scalar, createSerializableBigInt: scalar,
      createSerializableUndefined: () => scalar(undefined), createSerializableNull: () => scalar(null),
      createSerializableArray: values => ref('array', values),
      createSerializableObject: values => ref('object', values),
      createSerializableWorklet: values => ref('worklet', values),
      createSerializableHostObject: value => ref('host', value),
      createSerializableArrayBuffer: value => ref('buffer', value.slice(0)),
      createSerializableError: (name, message, stack) => ref('error', { name, message, stack }),
      createSerializableArrayBufferView: (type, buffer, offset, length) =>
        ref('view', { type, buffer: buffer.slice(0), offset, length }),
      createSerializableNonWorkletFunction: fn => ref(hostFunctions.has(fn) ? 'hostFunction' : 'remote', fn),
      createSerializableLEGACY(values) {
        return ref(values.__workletHash ? 'worklet' : 'object', values);
      },
      createShareable(id, initial) {
        assert.equal(id, uiId);
        assert.equal(name, 'RN');
        const guest = host({});
        hostResources.set(guest, { initial });
        return guest;
      },
    };
    runtime.context = vm.createContext({
      __DEV__: false, _WORKLETS_BUNDLE_MODE_ENABLED: false,
      __RUNTIME_KIND: name === 'RN' ? 1 : 2,
      __workletsModuleProxy: bridge,
      __shareableGuestUnpacker: (_id, guest) => guest,
      ArrayBuffer, Float32Array, Float64Array, Error,
      Date: class extends Date { static now() { return h.now; } },
      performance: { now: () => h.now },
    });
    vm.runInContext('globalThis.global = globalThis', runtime.context);
    for (const suffix of ['String', 'Number', 'Boolean', 'BigInt', 'Undefined', 'Null', 'Array', 'HostObject']) {
      runtime.context[`_createSerializable${suffix}`] = bridge[`createSerializable${suffix}`];
    }
    const mapping = new WeakMap();
    const mappingFlag = Symbol('serialized');
    const modules = new Map();
    const imports = {
      '../debug/errors': { registerWorkletStackDetails() {} },
      '../debug/jsVersion': { jsVersion: '0.10.0' },
      '../debug/logger': { logger: { warn() {} } },
      '../runtimeKind': { RuntimeKind: { ReactNative: 1 }, getRuntimeKind: () => name === 'RN' ? 1 : 2 },
      '../WorkletsModule/NativeWorklets': { WorkletsModule: bridge },
      './isSynchronizable': { isSynchronizable: () => false },
      './remoteFunctionRegistry': { nextRemoteFunctionId: 0, registerRemoteFunction() {} },
      './serializableMappingCache': { serializableMappingFlag: mappingFlag,
        serializableMappingCache: { get: value => mapping.get(value),
          set: (value, clone = mappingFlag) => mapping.set(value, clone) } },
      '../guardImplementation': { addNoBundleModeGuardImplementation() {} },
    };
    runtime.load = relative => {
      assert.ok(dependencyFiles.has(relative), `dependency read not allowlisted: ${relative}`);
      if (!modules.has(relative)) {
        const filename = path.join(workletsRoot, 'src', relative);
        modules.set(relative, evaluate(compile(filename, false, false), runtime.context, specifier => {
          if (specifier === '../workletFunction') return runtime.load('workletFunction.ts');
          if (specifier === './serializable') return runtime.load('memory/serializable.native.ts');
          assert.ok(Object.hasOwn(imports, specifier), `unmocked dependency: ${specifier}`);
          return imports[specifier];
        }, filename));
      }
      return modules.get(relative);
    };
    runtime.load('memory/valueUnpacker.native.ts').installValueUnpacker();
    runtime.load('memory/shareableHostUnpacker.native.ts').installShareableHostUnpacker();
    const serializers = runtime.load('memory/serializable.native.ts');
    runtime.serialize = name === 'RN' ? serializers.createSerializable : serializers.makeShareableCloneOnUIRecursive;
    runtime.isWorklet = runtime.load('workletFunction.ts').isWorkletFunction;
    runtimes[name] = runtime;
    return runtime;
  }
  const rn = makeRuntime('RN');
  const worker = makeRuntime('Worker');
  const ui = makeRuntime('UI');

  function queueUI(fn, args) {
    const source = runtimes[h.runtime];
    if (!source.isWorklet(fn)) throw new Error('[Worklets] The function passed to scheduleOnRuntimeWithId is not a worklet.');
    const functionPacket = source.serialize(fn);
    const argsPacket = source.serialize(args);
    h.ui.push(() => {
      const callback = unpack(functionPacket, ui);
      callback(...unpack(argsPacket, ui));
      h.uiExecutions += 1;
    });
  }
  function noBuffers(value) {
    assert.ok(!(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value), 'RN must never receive image/pose buffers');
    if (value && typeof value === 'object') Object.values(value).forEach(noBuffers);
  }
  const worklets = {
    UIRuntimeId: uiId,
    createShareable: rn.load('memory/shareable.native.ts').createShareable,
    scheduleOnUI(fn, ...args) { assert.equal(h.runtime, 'RN'); queueUI(fn, args); },
    scheduleOnRuntimeWithId(id, fn, ...args) {
      assert.equal(h.runtime, 'Worker'); assert.equal(id, uiId);
      queueUI(fn, args); h.dispatches += 1;
    },
    scheduleOnRN(fn, ...args) {
      assert.equal(h.runtime, 'UI', 'no Worker → RN bounce');
      args.forEach(noBuffers);
      assert.equal(fn.__remoteFunction?.kind, 'remote');
      h.rn.push(() => fn.__remoteFunction.value(...args));
    },
  };
  for (const fn of Object.values(worklets)) if (typeof fn === 'function') hostFunctions.add(fn);
  const shared = initial => {
    let value = typeof initial === 'function' ? initial() : initial;
    return host({ get: () => value, set: next => { value = next; }, modify: fn => { value = fn(value); } });
  };
  const native = {
    react: { useCallback: fn => fn, useMemo: fn => fn(), useEffect: fn => { h.effect = fn; },
      useRef: value => ({ current: value }), useState: value => [value, next => { h.error = next; }] },
    'react/compiler-runtime': { c: size => Array(size).fill(Symbol.for('react.memo_cache_sentinel')) },
    'react-native-reanimated': { useSharedValue: shared, useFrameCallback: fn => { h.expire = fn; } },
    'react-native-vision-camera': { useFrameOutput: options => options },
    'react-native-vision-camera-resizer': { useResizer: () => ({ state: 'ready', resizer: h.resizer }) },
    'react-native-worklets': worklets,
  };
  const appModules = new Map();
  function loadApp(filename) {
    assert.ok(appFiles.has(filename), `app read not allowlisted: ${filename}`);
    if (!appModules.has(filename)) {
      appModules.set(filename, evaluate(compile(filename, supportsReactCompiler, true), rn.context, specifier => {
        if (Object.hasOwn(native, specifier)) return native[specifier];
        assert.ok(specifier.startsWith('.'), `unmocked app import: ${specifier}`);
        return loadApp(path.resolve(path.dirname(filename), `${specifier}.ts`));
      }, filename));
    }
    return appModules.get(filename);
  }
  h.raw = new Float32Array(51);
  for (let i = 0; i < 51; i += 3) h.raw.set([0.5, 0.5, 0.75], i);
  h.raw.set([0.5, 0.25, 0.75], 0);
  h.raw.set([0.25, 0.5, 0.75], 33);
  h.raw.set([0.75, 0.5, 0.75], 45);
  const input = new ArrayBuffer(192 * 192 * 3);
  let disposed = false;
  h.resizer = host({ resize() {
    assert.equal(h.runtime, 'Worker'); disposed = false;
    return { getPixelBuffer: () => input, dispose() { disposed = true; h.releases.push('resized'); } };
  } });
  const model = host({ runSync(inputs) {
    assert.equal(h.runtime, 'Worker'); assert.equal(disposed, false); assert.equal(inputs[0], input);
    h.runs += 1; h.duringInference?.(); h.now += 4;
    if (h.fail) throw new Error('synthetic inference failure');
    return [h.raw.buffer];
  } });
  const pipelineModule = loadApp(pipelinePath);
  h.pipeline = pipelineModule.usePosePipeline(model, true, summary => {
    assert.equal(h.runtime, 'RN'); h.summaries.push({ ...summary });
  }, (angle, bodyVisible) => {
    assert.equal(h.runtime, 'RN');
    assert.ok(angle === null || typeof angle === 'number'); assert.equal(typeof bodyVisible, 'boolean');
    h.samples.push({ angle, bodyVisible });
  });
  h.rnFrame = h.pipeline.output.onFrame;
  assert.ok(rn.isWorklet(h.rnFrame), 'actual Expo transform workletizes onFrame');
  h.workerFrame = unpack(rn.serialize(h.rnFrame), worker);
  h.flushUI = () => h.on('UI', () => { while (h.ui.length) h.ui.shift()(); });
  h.flushRN = () => h.on('RN', () => { while (h.rn.length) h.rn.shift()(); });
  h.cleanup = h.effect(); h.flushUI(); h.flushRN();
  h.samples.length = 0; h.summaries.length = 0; h.uiExecutions = 0;
  h.frame = () => h.on('Worker', () => h.workerFrame({
    width: 192, height: 192, orientation: 'up', dispose: () => h.releases.push('frame'),
  }));
  h.restart = () => { h.on('RN', () => { h.cleanup(); h.cleanup = h.effect(); }); h.flushUI(); };
  h.queueBadWrapper = () => {
    // Отрицательный контроль: свежий hash не спасает захват уже unpacked-функции.
    const code = transform(`module.exports = callback => () => {
      'worklet'; callback();
    };`, { filename: path.join(mobile, 'boundary-negative-control.ts'), cwd: mobile,
      configFile: false, babelrc: false, presets: [presetPath],
      caller: { name: 'metro', platform: 'ios', engine: 'hermes', bundler: 'metro',
        isDev: true, isServer: false, supportsStaticESM: false, supportsReactCompiler },
    }).code;
    const makeWrapper = evaluate(code, worker.context, () => assert.fail('unexpected import'), 'negative-control');
    const wrapper = makeWrapper(h.workerFrame);
    assert.ok(worker.isWorklet(wrapper));
    h.on('Worker', () => queueUI(wrapper, []));
  };
  return h;
}

for (const compiler of [false, true]) {
  const mode = `Expo iOS/Hermes compiler=${compiler}, Legacy Eval`;
  test(`${mode}: RN metadata does not survive the actual first unpack`, () => {
    const h = setup(compiler);
    assert.equal(typeof h.rnFrame.__workletHash, 'number');
    assert.equal(typeof h.rnFrame.__initData.code, 'string');
    assert.equal(h.workerFrame.__workletHash, undefined);
  });

  test(`${mode}: a fresh wrapper around an unpacked callback fails on the second hop`, () => {
    const h = setup(compiler);
    h.queueBadWrapper();
    assert.throws(h.flushUI, /callback is not a function/);
    assert.equal(h.uiExecutions, 0);
    assert.equal(h.pipeline.pose.get(), null);
    assert.deepEqual(h.samples, []);
  });

  test(`${mode}: second unpack executes pose publication, with owned bytes and scalar-only RN`, () => {
    const h = setup(compiler);
    assert.doesNotThrow(h.frame);
    assert.deepEqual(h.releases, ['resized', 'frame']);
    assert.equal(h.rn.length, 0); assert.equal(h.pipeline.pose.get(), null);
    h.raw.fill(0);
    assert.doesNotThrow(h.flushUI);
    assert.equal(h.dispatches, 1); assert.equal(h.uiExecutions, 1);
    const snapshot = h.pipeline.pose.get();
    assert.equal(snapshot.points.byteLength, 204);
    assert.deepEqual([...snapshot.points.subarray(0, 3)], [0.25, 0.5, 0.75]);
    h.flushRN();
    assert.deepEqual(h.samples, [{ angle: 180, bodyVisible: true }]);
    assert.deepEqual(h.summaries, [{ angle: 180, bodyVisible: true, modelFps: null, avgMs: 4, p95Ms: 4 }]);
  });

  test(`${mode}: second unpack executes failure publication and stops the failed epoch`, () => {
    const h = setup(compiler);
    h.pipeline.pose.set({ previous: true });
    h.fail = true;
    assert.doesNotThrow(h.frame);
    assert.deepEqual(h.releases, ['resized', 'frame']); assert.equal(h.error, null);
    assert.doesNotThrow(h.flushUI);
    assert.equal(h.dispatches, 1); assert.equal(h.uiExecutions, 1);
    assert.equal(h.pipeline.pose.get(), null);
    h.flushRN();
    assert.equal(h.error, 'Распознавание остановилось. Повторите запуск камеры.');
    assert.deepEqual(h.samples, [{ angle: null, bodyVisible: false }]);
    assert.deepEqual(h.summaries, [{ angle: null, bodyVisible: false, modelFps: null, avgMs: null, p95Ms: null }]);
    h.now += 100; h.frame();
    assert.equal(h.runs, 1); assert.deepEqual(h.releases, ['resized', 'frame', 'frame']);
  });

  for (const fail of [false, true]) {
    test(`${mode}: unpacked ${fail ? 'failure' : 'pose'} cannot publish across an epoch reset`, () => {
      const h = setup(compiler);
      h.fail = fail; h.duringInference = h.restart;
      h.frame(); h.flushUI(); h.flushRN();
      assert.equal(h.pipeline.pose.get(), null); assert.equal(h.error, null);
      assert.ok(h.samples.every(sample => sample.angle === null && !sample.bodyVisible));
      h.fail = false; h.duringInference = null;
      h.frame(); h.flushUI(); h.flushRN();
      assert.equal(h.samples.at(-1).angle, 180);
      assert.deepEqual(h.releases, ['resized', 'frame', 'resized', 'frame']);
    });
  }
}
