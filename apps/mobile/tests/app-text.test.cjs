/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { createElement } = require('react');
const ts = require('typescript');

// Настоящий AppText и React JSX; подменена только граница native/dimensions.
// Проверяем контракт leaf-key/props, не native layout или React lifecycle.
let dimensions;
let AppText;
const native = { Text: 'NativeText', useWindowDimensions: () => dimensions };
const wrapperPath = path.resolve(__dirname, '../src/shared/ui/AppText.tsx');
const wrapperURL = pathToFileURL(wrapperPath).href;
const nativeKey = Symbol.for('app-text-test-native');

function render(props = {}) {
  if (!AppText) {
    assert.ok(existsSync(wrapperPath), 'shared AppText wrapper must exist');
    globalThis[nativeKey] = native;
    const hooks = registerHooks({
      resolve(specifier, context, next) {
        if (specifier === 'react-native' && context.parentURL === wrapperURL) {
          return { url: 'app-text-test:native', shortCircuit: true };
        }
        return next(specifier, context);
      },
      load(url, context, next) {
        if (url === 'app-text-test:native') {
          return { format: 'module', shortCircuit: true,
            source: "export const { Text, useWindowDimensions } = globalThis[Symbol.for('app-text-test-native')];" };
        }
        if (url === wrapperURL) {
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
    try { ({ AppText } = require(wrapperPath)); }
    finally { hooks.deregister(); delete globalThis[nativeKey]; }
  }
  return AppText(props);
}

test.beforeEach(() => { dimensions = { width: 400, height: 800, scale: 3, fontScale: 1 }; });

test('same fontScale keeps the Text key across content and window changes', () => {
  const first = render({ children: 'Голос включён' });
  const repeated = render({ children: 'Голос включён' });
  dimensions = { width: 800, height: 400, scale: 2, fontScale: 1 };
  const changedWindow = render({ children: 'Голос выключен' });
  assert.equal(first.type, native.Text);
  assert.equal(repeated.key, first.key);
  assert.equal(changedWindow.key, first.key);
  assert.equal(changedWindow.props.children, 'Голос выключен');
});

test('fontScale changes replace only the returned native Text key in both directions', () => {
  const normal = render({ children: 'Счёт' });
  dimensions = { ...dimensions, fontScale: 3.1 };
  const large = render({ children: 'Счёт' });
  const repeatedLarge = render({ children: 'Счёт' });
  dimensions = { ...dimensions, fontScale: 1 };
  const normalAgain = render({ children: 'Счёт' });
  for (const leaf of [normal, large, repeatedLarge, normalAgain]) assert.equal(leaf.type, native.Text);
  assert.notEqual(large.key, normal.key, 'fontScale change must invalidate the native Text leaf');
  assert.equal(repeatedLarge.key, large.key);
  assert.notEqual(normalAgain.key, large.key);
  assert.equal(normalAgain.key, normal.key);
});

test('remount key preserves Text props, style identity, nested children, ref and callbacks', () => {
  const style = [{ fontSize: 17, lineHeight: 25 }, false, { color: '#F3F8F7' }];
  const children = ['Цель ', createElement(native.Text, { key: 'value' }, '10')];
  const props = {
    children, style, ref: { current: null }, testID: 'target',
    accessibilityLabel: 'Цель 10 повторений', accessibilityRole: 'header',
    accessibilityHint: 'Следующий подход', accessibilityLiveRegion: 'polite',
    accessibilityState: { selected: true }, accessible: true,
    allowFontScaling: true, maxFontSizeMultiplier: 0, numberOfLines: 2, selectable: true,
    onPress() {}, onLayout() {}, onTextLayout() {},
  };
  for (const fontScale of [1, 3.1]) {
    dimensions = { ...dimensions, fontScale };
    const leaf = render(props);
    assert.equal(leaf.type, native.Text);
    assert.deepEqual(leaf.props, props);
    for (const name of ['style', 'children', 'ref', 'onPress', 'onLayout', 'onTextLayout']) {
      assert.equal(leaf.props[name], props[name], `${name} must be forwarded unchanged`);
    }
  }
});

test('default font scaling stays native and explicit scaling props are not overwritten', () => {
  for (const fontScale of [1, 3.1]) {
    dimensions = { ...dimensions, fontScale };
    assert.deepEqual(render({ children: 'Текст' }).props, { children: 'Текст' });
    for (const allowFontScaling of [true, false]) {
      const props = { children: 'Текст', allowFontScaling, maxFontSizeMultiplier: 2 };
      assert.deepEqual(render(props).props, props);
    }
  }
});
