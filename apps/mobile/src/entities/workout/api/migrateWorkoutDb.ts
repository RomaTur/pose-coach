export interface MigrationConnection {
  execSync(sql: string): void;
  getFirstSync<T>(sql: string): T | null;
  withTransactionSync(task: () => void): void;
}

// Только доверенный статический SQL. Пользовательские значения идут через bindings ORM.
const INITIAL_SCHEMA = `
  CREATE TABLE workouts (
    id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 128),
    mode TEXT NOT NULL CHECK(mode IN ('live', 'demo')),
    started_at INTEGER NOT NULL CHECK(typeof(started_at) = 'integer' AND started_at >= 0),
    ended_at INTEGER NOT NULL CHECK(typeof(ended_at) = 'integer' AND ended_at >= started_at),
    duration_ms INTEGER NOT NULL CHECK(typeof(duration_ms) = 'integer'
      AND duration_ms >= 0 AND duration_ms <= ended_at - started_at),
    reps INTEGER NOT NULL CHECK(typeof(reps) = 'integer' AND reps >= 0),
    target INTEGER NOT NULL CHECK(typeof(target) = 'integer' AND target BETWEEN 1 AND 100)
  );
  CREATE INDEX workouts_mode_ended ON workouts(mode, ended_at DESC);
`;

export function migrateWorkoutDb(db: MigrationConnection): void {
  const current = db.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version;
  if (current == null || !Number.isInteger(current) || current < 0) throw new Error('Invalid schema version');
  if (current > 1) throw new Error('Database schema is newer than this app');
  db.execSync('PRAGMA journal_mode = WAL;');
  if (current === 0) {
    // Версия обновляется атомарно вместе со схемой; сбой не маскируем успешной миграцией.
    db.withTransactionSync(() => {
      db.execSync(INITIAL_SCHEMA);
      db.execSync('PRAGMA user_version = 1;');
    });
  }
}
