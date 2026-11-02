const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_SETTINGS, readSettings, writeSettings } = require('../src/features/settings/model/settings.ts');

function memory() {
  const values = new Map();
  return { getString: key => values.get(key), set: (key, value) => values.set(key, value), values };
}

test('missing settings use independent defaults without writing', () => {
  const storage = memory();
  const result = readSettings(storage);
  assert.deepEqual(result, DEFAULT_SETTINGS);
  result.voice = false;
  assert.equal(DEFAULT_SETTINGS.voice, true);
  assert.equal(storage.values.size, 0);
});

test('settings survive a new reader with a versioned record', () => {
  const storage = memory();
  const settings = { voice: false, haptics: true, diagnostics: true, target: 20 };
  writeSettings(storage, settings);
  assert.deepEqual(readSettings(storage), settings);
  assert.equal(JSON.parse([...storage.values.values()][0]).version, 1);
});

test('corrupt and future settings fail visibly without overwriting', () => {
  for (const raw of ['{bad', JSON.stringify({ version: 2 }), JSON.stringify({ version: 1, voice: 'yes' })]) {
    const storage = { getString: () => raw, set: () => assert.fail('must not overwrite') };
    assert.throws(() => readSettings(storage));
  }
});

test('invalid values never reach storage', () => {
  const storage = { getString: () => undefined, set: () => assert.fail('must not write') };
  for (const changes of [{ target: 0 }, { target: 101 }, { target: 1.5 }, { voice: 1 }, { haptics: null }, { diagnostics: 'no' }]) {
    assert.throws(() => writeSettings(storage, { ...DEFAULT_SETTINGS, ...changes }));
  }
});

test('read and write errors are not swallowed', () => {
  const failure = new Error('storage unavailable');
  const storage = { getString: () => { throw failure; }, set: () => { throw failure; } };
  assert.throws(() => readSettings(storage), error => error === failure);
  assert.throws(() => writeSettings(storage, DEFAULT_SETTINGS), error => error === failure);
});
