/* global __dirname */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { isWorkoutRecord } = require('../src/entities/workout/model/workoutRecord.ts');
const { migrateWorkoutDb } = require('../src/entities/workout/api/migrateWorkoutDb.ts');

// Exercise the real repository/store in Node. Only native persistence boundaries
// are replaced; SQL/device behavior is not claimed by these regression tests.
let savedRow;
let inserts = 0;
let settingsValue;
let settingsReadFails = false;
let settingsWrites = 0;
const native = {
  'expo-sqlite': {
    openDatabaseSync: () => ({
      getFirstSync: () => ({ user_version: 1 }), execSync() {}, closeSync() {},
    }),
  },
  'drizzle-orm/expo-sqlite': {
    drizzle: () => ({
      select: () => ({ from: () => ({ where: () => ({ get: () => savedRow }) }) }),
      insert: () => ({ values: row => ({ run() {
        const { id, mode, startedAt, endedAt, durationMs, reps, target } = row;
        savedRow = { id, mode, startedAt, endedAt, durationMs, reps, target };
        inserts += 1;
      } }) }),
    }),
  },
  'react-native-mmkv': {
    createMMKV: () => ({
      getString() {
        if (settingsReadFails) throw new Error('synthetic storage read failure');
        return settingsValue;
      },
      set(key, value) { settingsValue = value; settingsWrites += 1; },
    }),
  },
};
const nativeKey = Symbol.for('workout-storage-test-native');
globalThis[nativeKey] = native;
const sourceRoot = pathToFileURL(path.resolve(__dirname, '../src') + path.sep).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (Object.hasOwn(native, specifier)) {
      return { url: `workout-storage-test:${specifier}`, shortCircuit: true };
    }
    if (specifier.startsWith('.') && context.parentURL?.startsWith(sourceRoot) &&
        !path.extname(specifier)) return next(`${specifier}.ts`, context);
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('workout-storage-test:')) {
      const name = url.slice('workout-storage-test:'.length);
      return { format: 'module', shortCircuit: true,
        source: `export const { ${Object.keys(native[name]).join(', ')} } = globalThis[Symbol.for('workout-storage-test-native')][${JSON.stringify(name)}];` };
    }
    return next(url, context);
  },
});
let saveWorkout;
let useSettingsStore;
try {
  ({ saveWorkout } = require('../src/entities/workout/api/workoutRepository.ts'));
  ({ useSettingsStore } = require('../src/features/settings/model/settingsStore.ts'));
} finally {
  hooks.deregister();
  delete globalThis[nativeKey];
}

const record = () => ({ id: 'test-session', mode: 'live', startedAt: 1000,
  endedAt: 9000, durationMs: 5000, reps: 3, target: 10 });
const connect = database => ({
  execSync: sql => database.exec(sql),
  getFirstSync: sql => database.prepare(sql).get() ?? null,
  withTransactionSync: task => {
    database.exec('BEGIN');
    try { task(); database.exec('COMMIT'); }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  },
});

test('accepts completed live and explicitly marked demo records', () => {
  assert.equal(isWorkoutRecord(record()), true);
  assert.equal(isWorkoutRecord({ ...record(), mode: 'demo', reps: 0 }), true);
});
test('rejects corrupt or impossible workout records', () => {
  for (const bad of [null, {}, [],
    { ...record(), id: '' }, { ...record(), mode: 'unknown' },
    { ...record(), reps: -1 }, { ...record(), reps: 1.5 },
    { ...record(), target: 0 }, { ...record(), target: 101 },
    { ...record(), endedAt: 999 }, { ...record(), durationMs: 8001 },
    { ...record(), startedAt: NaN }, { ...record(), durationMs: Infinity },
  ]) assert.equal(isWorkoutRecord(bad), false);
});
test('repeat save ignores extra enumerable fields on a structurally valid workout', () => {
  savedRow = undefined;
  inserts = 0;
  const payload = Object.freeze({ ...record(), uiLabel: 'finished', retryCount: 1 });
  assert.equal(isWorkoutRecord(payload), true);
  saveWorkout(payload);
  assert.deepEqual(savedRow, record());
  assert.doesNotThrow(() => saveWorkout(payload));
  assert.doesNotThrow(() => saveWorkout({ ...payload, retryCount: 2, uiLabel: 'retry' }));
  assert.doesNotThrow(() => saveWorkout(record()));
  assert.equal(inserts, 1);
  assert.deepEqual(savedRow, record());
});
test('same-id saves still conflict for every differing persisted non-id field', () => {
  for (const change of [
    { mode: 'demo' }, { startedAt: 2000 }, { endedAt: 10000 },
    { durationMs: 4000 }, { reps: 4 }, { target: 11 },
  ]) {
    savedRow = undefined;
    inserts = 0;
    saveWorkout(record());
    const payload = { ...record(), ...change, uiLabel: 'retry' };
    assert.equal(isWorkoutRecord(payload), true);
    assert.throws(() => saveWorkout(payload), /Workout identifier conflict/);
    assert.equal(inserts, 1);
    assert.deepEqual(savedRow, record());
  }
});
test('failed settings reload retains custom values without claiming defaults', () => {
  settingsValue = undefined;
  settingsReadFails = false;
  settingsWrites = 0;
  useSettingsStore.getState().load();
  const custom = { voice: false, haptics: false, diagnostics: true, target: 25 };
  useSettingsStore.getState().change(custom);
  assert.deepEqual(useSettingsStore.getState().settings, custom);
  const storedBeforeFailure = settingsValue;
  settingsReadFails = true;
  try {
    useSettingsStore.getState().load();
    const state = useSettingsStore.getState();
    assert.deepEqual(state.settings, custom);
    assert.equal(state.ready, false);
    assert.equal(typeof state.error, 'string');
    assert.doesNotMatch(state.error, /стандартн|по умолчанию/i);
    assert.match(state.error, /текущие|без изменений/i);
    state.change({ target: 30 });
    assert.deepEqual(useSettingsStore.getState().settings, custom);
    assert.equal(settingsValue, storedBeforeFailure);
    assert.equal(settingsWrites, 1);
  } finally { settingsReadFails = false; }
});
test('initial migration creates constrained storage and survives running twice', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrateWorkoutDb(connect(db));
    db.prepare(`INSERT INTO workouts VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('first', 'live', 1000, 9000, 5000, 3, 10);
    migrateWorkoutDb(connect(db));
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(db.prepare('SELECT count(*) AS count FROM workouts').get().count, 1);
    assert.throws(() => db.prepare(`INSERT INTO workouts VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('second', 'unknown', 1000, 9000, 5000, 3, 10));
    assert.throws(() => db.prepare(`INSERT INTO workouts VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('first', 'live', 1000, 9000, 5000, 3, 10));
  } finally { db.close(); }
});
test('demo and live history are independently queryable', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrateWorkoutDb(connect(db));
    const insert = db.prepare('INSERT INTO workouts VALUES (?, ?, ?, ?, ?, ?, ?)');
    insert.run('live-one', 'live', 1000, 9000, 5000, 3, 10);
    insert.run('demo-one', 'demo', 1000, 9000, 5000, 99, 10);
    assert.equal(db.prepare('SELECT sum(reps) AS reps FROM workouts WHERE mode = ?').get('live').reps, 3);
  } finally { db.close(); }
});
test('newer schema is rejected without overwriting its version', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA user_version = 2');
    assert.throws(() => migrateWorkoutDb(connect(db)), /newer|version|schema/i);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
  } finally { db.close(); }
});
test('migration failure rolls back and never marks a partial schema as current', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const connection = connect(db);
    const broken = { ...connection, execSync(sql) {
      if (sql.includes('CREATE')) { connection.execSync(sql); throw new Error('disk failure'); }
      connection.execSync(sql);
    } };
    assert.throws(() => migrateWorkoutDb(broken), /disk failure/);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0);
    assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name = 'workouts'").get().count, 0);
  } finally { db.close(); }
});
