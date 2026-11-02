/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const { registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { createElement } = require('react');
const ts = require('typescript');
const { createCoachStore } = require('../src/features/coach/model/createCoachStore.ts');
const { shouldActivateCamera } = require('../src/features/camera/cameraPolicy.ts');

// Исполняем настоящий экран, панель, кнопки и store. Подменяем только окружение
// React/native; это проверка ветвления и обработчиков, не native-рендерер.
let current;
let hookOwner;
let hookIndex;
function hookSlot(initial) {
  let slots = current.hooks.get(hookOwner);
  if (!slots) { slots = []; current.hooks.set(hookOwner, slots); }
  return slots[hookIndex++] ??= { value: typeof initial === 'function' ? initial() : initial };
}
function renderComponent(component, props) {
  hookOwner = component;
  hookIndex = 0;
  return component(props);
}
const element = (type, props, key) => ({ type, props, key });
const coach = {
  coachStore: { getState: () => current.store.getState() },
  useCoachStore: selector => selector(current.store.getState()),
};
const settings = { useSettingsStore: selector => selector({
  settings: { voice: current.voice, haptics: false, diagnostics: false, target: 10 },
}) };
const replacements = {
  react: {
    createElement,
    useCallback: fn => fn,
    useEffect: (fn, deps) => {
      const slot = hookSlot();
      if (!slot.deps || deps.some((value, index) => !Object.is(value, slot.deps[index]))) {
        current.effects.push(() => { slot.cleanup?.(); slot.cleanup = fn(); slot.deps = deps; });
      }
    },
    useState: initial => {
      const slot = hookSlot(initial);
      return [slot.value, next => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
    },
    useRef: value => hookSlot(() => ({ current: value })).value,
  },
  'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
  'react-native': {
    View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', StatusBar: 'StatusBar',
    StyleSheet: { create: value => value, absoluteFill: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 } },
    Linking: { openSettings: async () => {} }, Alert: { alert: (...args) => { current.alert = args; } },
    AppState: { addEventListener: (_event, listener) => {
      current.appListeners.add(listener);
      return { remove: () => current.appListeners.delete(listener) };
    } },
    useWindowDimensions: () => current.dimensions,
  },
  'expo-router': { router: { push() {} }, useFocusEffect: fn => { current.blur = fn(); } },
  'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  'react-native-vision-camera': {
    useCameraDevice: () => current.hasDevice ? { id: 'test-camera' } : undefined,
    useCameraPermission: () => ({ hasPermission: current.hasPermission,
      canRequestPermission: true, requestPermission: async () => true }),
  },
  'expo-haptics': { ImpactFeedbackStyle: { Light: 'Light' }, impactAsync: async () => {} },
  'expo-speech': { stop: async () => {}, speak: words => current.spoken.push(words) },
  'react-native-reanimated': { useSharedValue: initial => hookSlot(() => ({
    value: initial, set(value) { this.value = value; }, get() { return this.value; },
  })).value },
  '../pose/inference/usePosePipeline': { EMPTY_POSE_SUMMARY: {
    angle: null, bodyVisible: false, modelFps: null, avgMs: null, p95Ms: null,
  } },
  '../pose/inference/useMoveNetModel': { useMoveNetModel: () => ({ status: current.modelStatus, model: {} }) },
  '../coach/model/coachStore': coach,
  './model/coachStore': coach,
  '../settings/model/settingsStore': settings,
  '../pose/overlay/PoseOverlay': { PoseOverlay: 'PoseOverlay' },
  './PoseCameraPreview': { PoseCameraPreview: 'PoseCameraPreview' },
  './useCameraActivity': {
    useCameraActivity: (hasPermission, hasDevice, isPaused, hasError) => shouldActivateCamera({
      hasPermission, hasDevice, isPaused, hasError, isFocused: true, appState: current.appState,
    }),
  },
};

const sourceRoot = pathToFileURL(path.resolve(__dirname, '../src') + path.sep).href;
const key = Symbol.for('camera-workout-controls-test');
globalThis[key] = replacements;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (Object.hasOwn(replacements, specifier)) {
      return { url: `camera-workout-test:${specifier}`, shortCircuit: true };
    }
    if (specifier.startsWith('.') && context.parentURL?.startsWith(sourceRoot) && !path.extname(specifier)) {
      const extension = ['/WorkoutPanel', '/DemoPreview', '/coachUi', '/AppText'].some(name => specifier.endsWith(name)) ? '.tsx' : '.ts';
      return next(`${specifier}${extension}`, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('camera-workout-test:')) {
      const name = url.slice('camera-workout-test:'.length);
      return { format: 'module', shortCircuit: true,
        source: `export const { ${Object.keys(replacements[name]).join(', ')} } = globalThis[Symbol.for('camera-workout-controls-test')][${JSON.stringify(name)}];` };
    }
    if (url.startsWith(sourceRoot) && url.endsWith('.tsx')) {
      // Компиляция TSX штатным загрузчиком без записи сборки или чтения исходника в отчёт.
      const loaded = next(url, { ...context, format: 'module' });
      const source = typeof loaded.source === 'string' ? loaded.source : new TextDecoder().decode(loaded.source);
      return { ...loaded, format: 'module', source: ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.ES2022 },
      }).outputText };
    }
    return next(url, context);
  },
});
let CameraScreen;
try {
  ({ CameraScreen } = require('../src/features/camera/CameraScreen.tsx'));
} finally {
  hooks.deregister();
  delete globalThis[key];
}

function expand(node) {
  if (Array.isArray(node)) return node.flatMap(expand);
  if (node == null || typeof node === 'boolean') return [];
  if (typeof node !== 'object') return [node];
  if (typeof node.type === 'function') return expand(renderComponent(node.type, node.props));
  return [{ ...node, props: { ...node.props, children: expand(node.props?.children) } }];
}
function findButton(nodes, label) {
  for (const node of nodes) {
    if (typeof node !== 'object') continue;
    if (node.type === 'Pressable' && text(node.props.children) === label) return node;
    const found = findButton(node.props.children, label);
    if (found) return found;
  }
}
function text(nodes) {
  return nodes.map(node => typeof node === 'object' ? text(node.props.children) : String(node)).join('');
}
function findPath(nodes, predicate, ancestors = []) {
  for (const node of nodes) {
    if (typeof node !== 'object') continue;
    const next = [...ancestors, node];
    if (predicate(node)) return next;
    const found = findPath(node.props.children, predicate, next);
    if (found) return found;
  }
}
function style(node) {
  return Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
}
function press(nodes, label) {
  const button = findButton(nodes, label);
  assert.ok(button, `Недоступна кнопка «${label}»`);
  assert.equal(button.props.disabled, false, `Кнопка «${label}» не должна блокироваться камерой`);
  button.props.onPress();
}

function fixture(t, phase) {
  const f = { now: 1000, hasPermission: true, hasDevice: true, effects: [], records: [],
    hooks: new Map(), appListeners: new Set(), timers: new Map(), spoken: [],
    modelStatus: 'ready', appState: 'active', voice: false,
    dimensions: { width: 400, height: 800, scale: 3, fontScale: 1 } };
  f.store = createCoachStore({ now: () => f.now, id: () => 'live-session',
    save: record => {
      f.onSave?.();
      if (f.failSave) throw new Error('disk full');
      f.records.push(record);
    } });
  current = f;
  t.mock.method(Date, 'now', () => f.now);
  let timerId = 0;
  t.mock.method(globalThis, 'setInterval', (fn, delay) => {
    const id = ++timerId;
    f.timers.set(id, { fn, delay, next: f.now + delay });
    return id;
  });
  t.mock.method(globalThis, 'clearInterval', id => f.timers.delete(id));
  t.after(() => {
    for (const slots of f.hooks.values()) for (const slot of slots) slot.cleanup?.();
  });
  f.act = action => f.store.getState().dispatch(action);
  f.render = () => {
    f.effects = [];
    return expand(renderComponent(CameraScreen));
  };
  f.flushEffects = () => { for (const effect of f.effects.splice(0)) effect(); };
  f.advance = duration => {
    const end = f.now + duration;
    while (true) {
      const timer = [...f.timers.values()].sort((a, b) => a.next - b.next)[0];
      if (!timer || timer.next > end) break;
      f.now = timer.next;
      timer.next += timer.delay;
      timer.fn();
      f.render(); f.flushEffects();
    }
    f.now = end;
  };
  if (phase === 'setup') return f;
  f.act({ type: 'start' });
  if (phase === 'preparing') { f.now = 1500; return f; }
  f.act({ type: 'pose', bodyVisible: true, angle: 170 });
  if (phase === 'countdown') { f.now = 1500; return f; }
  for (const now of [2000, 3000]) {
    f.now = now; f.act({ type: 'pose', bodyVisible: true, angle: 170 });
  }
  f.now = 4000;
  f.act({ type: 'tick' });
  // Один настоящий повтор через FSM, а не вручную подставленный счётчик.
  for (const [now, angle] of [[4001, 170], [4201, 170], [4202, 90], [4402, 90], [4403, 170], [4603, 170]]) {
    f.now = now;
    f.act({ type: 'pose', angle, bodyVisible: true });
  }
  assert.equal(f.store.getState().session.counter.reps, 1);
  f.now = 4803;
  if (['paused', 'resume-preparing', 'resume-countdown'].includes(phase)) f.act({ type: 'pause' });
  if (phase.startsWith('resume-')) {
    f.now = 4903;
    f.act({ type: 'resume' });
    if (phase === 'resume-countdown') f.act({ type: 'pose', bodyVisible: true, angle: 170 });
    f.now = 5003;
  }
  return f;
}

for (const lost of ['permission', 'device']) {
  for (const phase of ['active', 'paused', 'preparing', 'countdown', 'resume-preparing', 'resume-countdown']) {
    test(`${phase}: потеря ${lost} не убирает завершение текущего подхода`, t => {
      const f = fixture(t, phase);
      assert.ok(findButton(f.render(), 'Завершить подход'));
      if (lost === 'permission') f.hasPermission = false;
      else f.hasDevice = false;
      // Проверяем и переходный рендер до lifecycle-effect, и устойчивую паузу после него.
      assert.ok(findButton(f.render(), 'Завершить подход'), 'Завершение пропало вместе с preview');
      f.flushEffects();
      assert.equal(f.store.getState().session.phase, 'paused');
      let tree = f.render();
      const resume = findButton(tree, 'Продолжить подход');
      assert.ok(resume);
      assert.equal(resume.props.disabled, true);
      assert.equal(f.store.getState().newSession('demo', 10), false);
      f.now += 1000;
      press(tree, 'Завершить подход');
      assert.equal(f.store.getState().session.phase, 'finished');
      assert.equal(f.store.getState().session.id, 'live-session');
      if (phase === 'preparing' || phase === 'countdown') {
        assert.deepEqual(f.records, []);
        assert.equal(f.store.getState().session.startedAt, null);
      } else {
        assert.deepEqual(f.records, [{ id: 'live-session', mode: 'live', startedAt: 4000,
          endedAt: phase.startsWith('resume-') ? 6003 : 5803,
          durationMs: 803, reps: 1, target: 10 }]);
        assert.equal(f.store.getState().saveStatus, 'saved');
      }
      tree = f.render();
      assert.ok(text(tree).includes('Подход завершён'));
      assert.ok(findButton(tree, 'Новый подход'));
      assert.equal(findButton(tree, 'Завершить подход'), undefined);
    });
  }
  test(`setup: без ${lost} новый live-подход по-прежнему недоступен`, t => {
    const f = fixture(t, 'setup');
    if (lost === 'permission') f.hasPermission = false;
    else f.hasDevice = false;
    const tree = f.render();
    assert.equal(findButton(tree, 'Начать подход'), undefined);
    assert.equal(findButton(tree, 'Завершить подход'), undefined);
  });
}

test('solo start: готовая камера разрешает намерение без тела, но ждёт новую позу', t => {
  const f = fixture(t, 'setup');
  press(f.render(), 'Начать подход');
  assert.equal(f.store.getState().session.phase, 'preparing');
  const tree = f.render();
  assert.match(text(tree), /отойдите/i);
  assert.match(text(tree), /плечи/i);
  assert.match(text(tree), /ноги|стопы/i);
  assert.match(text(tree), /отсч[её]т/i);
  assert.doesNotMatch(text(tree), /0повторений|0 повторений/);
  assert.ok(findButton(tree, 'Завершить подход'));
});

for (const modelStatus of ['loading', 'error']) {
  for (const phase of ['setup', 'paused']) {
    test(`${phase}: ${modelStatus} модели по-прежнему блокирует Start/Resume`, t => {
      const f = fixture(t, phase); f.modelStatus = modelStatus;
      const button = findButton(f.render(), phase === 'setup' ? 'Начать подход' : 'Продолжить подход');
      assert.ok(button);
      assert.equal(button.props.disabled, true);
    });
  }
}

test('solo Resume без тела сохраняет результат, отмена подготовки сохраняет его один раз', t => {
  const f = fixture(t, 'paused');
  press(f.render(), 'Продолжить подход');
  assert.equal(f.store.getState().session.phase, 'preparing');
  assert.equal(f.store.getState().session.counter.reps, 1);
  assert.equal(f.store.getState().session.elapsedMs, 803);
  f.now += 10000;
  press(f.render(), 'Завершить подход');
  assert.deepEqual(f.records, [{ id: 'live-session', mode: 'live', startedAt: 4000,
    endedAt: 14803, durationMs: 803, reps: 1, target: 10 }]);
});

test('ожидание обслуживается таймером 250ms без голосового старта и TTS-спама', t => {
  const f = fixture(t, 'preparing'); f.voice = true;
  f.render(); f.flushEffects();
  assert.ok([...f.timers.values()].some(timer => timer.delay === 250));
  f.advance(10000);
  assert.equal(f.store.getState().session.phase, 'preparing');
  assert.deepEqual(f.spoken, []);
  f.act({ type: 'pose', bodyVisible: true, angle: 170 });
  f.render(); f.flushEffects();
  assert.deepEqual(f.spoken, ['3']);
  f.advance(1250);
  assert.equal(f.store.getState().session.phase, 'preparing');
  const spoken = [...f.spoken];
  f.advance(3000);
  assert.deepEqual(f.spoken, spoken);
  assert.ok(!f.spoken.includes('Начинайте'));
});

for (const action of ['background', 'blur', 'camera-off']) {
  test(`preparing: ${action} отменяет подготовку, возврат не возобновляет её`, t => {
    const f = fixture(t, 'preparing');
    const tree = f.render(); f.flushEffects();
    if (action === 'background') {
      f.appState = 'background';
      for (const listener of f.appListeners) listener('background');
    } else if (action === 'blur') f.blur();
    else press(tree, 'Выключить камеру');
    assert.equal(f.store.getState().session.phase, 'paused');
    f.render(); f.flushEffects();
    if (action === 'background') {
      f.appState = 'active';
      for (const listener of f.appListeners) listener('active');
    } else if (action === 'camera-off') press(f.render(), 'Включить камеру');
    f.now += 5000;
    f.act({ type: 'pose', bodyVisible: true, angle: 170 }); f.act({ type: 'tick' });
    assert.equal(f.store.getState().session.phase, 'paused');
    press(f.render(), 'Завершить подход');
    assert.deepEqual(f.records, []);
  });
}

test('demo: настоящие синтетические pose каждые 80ms проводят подготовку через общий FSM', t => {
  const f = fixture(t, 'setup');
  f.store.getState().newSession('demo', 10);
  f.render(); f.flushEffects();
  assert.ok([...f.timers.values()].some(timer => timer.delay === 80));
  f.advance(80);
  assert.equal(f.store.getState().session.phase, 'setup');
  press(f.render(), 'Начать подход');
  assert.equal(f.store.getState().session.phase, 'preparing');
  f.render(); f.flushEffects();
  f.advance(80);
  assert.equal(f.store.getState().session.phase, 'countdown');
  assert.equal(f.store.getState().session.countdownUntil, 4160);
  f.advance(2999);
  assert.equal(f.store.getState().session.phase, 'countdown');
  assert.equal(f.store.getState().session.counter.reps, 0);
  f.advance(251);
  assert.equal(f.store.getState().session.phase, 'active');
  assert.equal(f.store.getState().session.startedAt, 4160);
  f.advance(8000);
  assert.ok(f.store.getState().session.counter.reps > 0);
  assert.equal(f.store.getState().session.mode, 'demo');
});

for (const phase of ['preparing', 'countdown', 'active', 'paused']) {
  test(`${phase}: основные действия отдельно от прокрутки камеры, внутри нижней safe area`, t => {
    const f = fixture(t, phase);
    for (const dimensions of [
      { width: 400, height: 800, scale: 3, fontScale: 1 },
      { width: 320, height: 568, scale: 2, fontScale: 3.2 },
    ]) {
      f.dimensions = dimensions;
      const tree = f.render();
      const cameraPath = findPath(tree, node => node.type === 'PoseCameraPreview');
      const finishPath = findPath(tree, node => node.type === 'Pressable' && text(node.props.children) === 'Завершить подход');
      assert.ok(cameraPath && finishPath);
      const cameraScroll = cameraPath.find(node => node.type === 'ScrollView');
      const controlsScroll = finishPath.find(node => node.type === 'ScrollView');
      assert.ok(controlsScroll, 'Крупный текст действий должен прокручиваться');
      assert.notStrictEqual(cameraScroll, controlsScroll, 'Управление уходит вместе с длинным содержимым камеры');
      assert.equal(finishPath[0].type, 'SafeAreaView');
      assert.ok(finishPath[0].props.edges?.includes('bottom'));
      assert.equal(finishPath[1], controlsScroll, 'Зона действий — отдельный нижний сосед, не overlay');
      assert.match(style(controlsScroll).maxHeight ?? '', /^[1-9]\d?%$/, 'Зона действий должна быть ограничена частью высоты');
      assert.notEqual(controlsScroll.props.scrollEnabled, false);
      for (const node of finishPath) {
        assert.notEqual(style(node).position, 'absolute');
        assert.notEqual(node.props.allowFontScaling, false);
      }
      assert.equal(style(cameraScroll).minHeight, 0);
      assert.match(text([controlsScroll]), phase === 'preparing' ? /отойдите/i
        : phase === 'countdown' ? /Приготовьтесь|До начала/i : /повторений/);
    }
    f.flushEffects();
    assert.equal([...f.timers.values()].filter(timer => timer.delay === 250).length, phase === 'paused' ? 0 : 1);
    press(f.render(), 'Завершить подход');
    assert.equal(f.store.getState().session.phase, 'finished');
  });
}

test('phase и Dynamic Type не меняют ancestry/key камеры и не создают вторую панель', t => {
  const f = fixture(t, 'setup');
  const pathKey = tree => findPath(tree, node => node.type === 'PoseCameraPreview')
    .map(node => [node.type, node.key]);
  const initial = pathKey(f.render());
  press(f.render(), 'Начать подход');
  const sessionId = f.store.getState().session.id;
  f.render(); f.flushEffects();
  f.dimensions = { width: 320, height: 568, scale: 2, fontScale: 3.2 };
  let tree = f.render();
  assert.deepEqual(pathKey(tree), initial);
  assert.equal(text(tree).split('Завершить подход').length - 1, 1);
  assert.equal([...f.timers.values()].filter(timer => timer.delay === 250).length, 1);
  f.act({ type: 'pause' });
  tree = f.render(); f.flushEffects();
  assert.deepEqual(pathKey(tree), initial);
  assert.equal(f.store.getState().session.id, sessionId);
});

test('demo: подпись вне измеряемого viewport; overlay получает только размеры области позы', t => {
  const f = fixture(t, 'setup');
  f.store.getState().newSession('demo', 10);
  let tree = f.render();
  const overlayPath = findPath(tree, node => node.type === 'PoseOverlay');
  const measured = overlayPath.findLast(node => node.props.onLayout);
  assert.ok(measured);
  assert.doesNotMatch(text([measured]), /Синтетическая поза/, 'Подпись включена в координатную область');
  const labelPath = findPath(tree, node => node.type === 'Text' && text(node.props.children).includes('Синтетическая поза'));
  assert.ok(labelPath);
  assert.ok(!labelPath.includes(measured));
  assert.notEqual(style(labelPath.at(-1)).position, 'absolute');
  measured.props.onLayout({ nativeEvent: { layout: { width: 288, height: 220, x: 0, y: 0 } } });
  tree = f.render();
  let overlay = findPath(tree, node => node.type === 'PoseOverlay').at(-1);
  assert.equal(overlay.props.width, 288);
  assert.equal(overlay.props.height, 220);
  f.dimensions.fontScale = 3.2;
  tree = f.render();
  overlay = findPath(tree, node => node.type === 'PoseOverlay').at(-1);
  assert.equal(overlay.props.height, 220, 'Рост подписи не входит в измерение скелета');
  assert.match(text(tree), /Синтетическая поза.*камера выключена/);
});

test('camera recovery: смена режима заблокирована с указанием завершить текущий подход', t => {
  const f = fixture(t, 'active');
  const before = f.store.getState().session;
  findPath(f.render(), node => node.type === 'PoseCameraPreview').at(-1).props.onError(new Error('camera failed'));
  let tree = f.render();
  const demo = findButton(tree, 'Посмотреть демонстрацию');
  assert.ok(demo);
  assert.equal(demo.props.disabled, true);
  assert.match(text(tree), /сначала завершите подход/i);
  assert.ok(findButton(tree, 'Завершить подход'));
  demo.props.onPress();
  assert.equal(f.store.getState().session.id, before.id);
  assert.equal(f.store.getState().session.mode, 'live');
  f.render(); f.flushEffects();
  tree = f.render();
  assert.equal(f.store.getState().session.phase, 'paused');
  press(tree, 'Завершить подход');
  assert.equal(f.store.getState().saveStatus, 'saved');
  press(f.render(), 'Посмотреть демонстрацию');
  assert.equal(f.store.getState().session.mode, 'demo');
  assert.equal(f.records.length, 1);
});

test('finished saving: до подтверждения сохранения нельзя сменить режим или начать новый подход', t => {
  const f = fixture(t, 'active');
  let tree;
  f.onSave = () => { tree = f.render(); };
  f.act({ type: 'finish' });
  const demo = findButton(tree, 'Посмотреть демонстрацию');
  assert.ok(demo);
  assert.equal(demo.props.disabled, true);
  assert.match(text(tree), /сохраняется|сохраняем/i);
  const next = findButton(tree, 'Новый подход');
  assert.ok(!next || next.props.disabled);
  assert.equal(f.store.getState().saveStatus, 'saved');
  press(f.render(), 'Посмотреть демонстрацию');
  assert.equal(f.store.getState().session.mode, 'demo');
});

for (const recovery of ['retry', 'discard']) {
  test(`finished error: ${recovery} разрешает смену режима только после явного решения`, t => {
    const f = fixture(t, 'active');
    f.failSave = true; f.act({ type: 'finish' });
    const finished = f.store.getState().session;
    let tree = f.render();
    assert.equal(findButton(tree, 'Посмотреть демонстрацию').props.disabled, true);
    assert.match(text(tree), /Повторить сохранение/);
    assert.match(text(tree), /Продолжить без сохранения/);
    findButton(tree, 'Посмотреть демонстрацию').props.onPress();
    assert.strictEqual(f.store.getState().session, finished);
    if (recovery === 'retry') {
      f.failSave = false; press(tree, 'Повторить сохранение');
      assert.equal(f.records.length, 1);
      assert.equal(f.records[0].reps, 1);
      assert.equal(f.records[0].id, finished.id);
    } else {
      press(tree, 'Продолжить без сохранения');
      assert.strictEqual(f.store.getState().session, finished);
      f.alert[2].find(button => button.style === 'destructive').onPress();
      assert.deepEqual(f.records, []);
    }
    tree = f.render();
    press(tree, 'Посмотреть демонстрацию');
    assert.equal(f.store.getState().session.mode, 'demo');
  });
}

test('отмена подготовки позволяет сменить режим без записи в историю', t => {
  const f = fixture(t, 'preparing');
  press(f.render(), 'Завершить подход');
  assert.equal(f.store.getState().session.startedAt, null);
  press(f.render(), 'Посмотреть демонстрацию');
  assert.equal(f.store.getState().session.mode, 'demo');
  assert.deepEqual(f.records, []);
});

test('active lost-body: подсказка возвращает в кадр, не предлагает отсутствующие Start/Resume', t => {
  const f = fixture(t, 'active');
  const tree = f.render();
  assert.doesNotMatch(text(tree), /Начать подход|Продолжить подход/);
  assert.match(text(tree), /вернитесь.*кадр|покажите.*плечи/i);
  assert.ok(findButton(tree, 'Приостановить подход'));
});
