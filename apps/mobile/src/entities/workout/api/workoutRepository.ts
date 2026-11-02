import { and, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { openDatabaseSync } from 'expo-sqlite';

import { isWorkoutRecord, type WorkoutRecord } from '../model/workoutRecord';
import { migrateWorkoutDb } from './migrateWorkoutDb';

const workouts = sqliteTable('workouts', {
  id: text('id').primaryKey(),
  mode: text('mode', { enum: ['live', 'demo'] }).notNull(),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at').notNull(),
  durationMs: integer('duration_ms').notNull(),
  reps: integer('reps').notNull(),
  target: integer('target').notNull(),
});

function openRepository() {
  const sqlite = openDatabaseSync('pose-coach.db');
  try { migrateWorkoutDb(sqlite); }
  catch (error) { sqlite.closeSync(); throw error; }
  return drizzle(sqlite, { schema: { workouts } });
}
let database: ReturnType<typeof openRepository> | undefined;
function getDatabase() {
  // Ошибка открытия остаётся ошибкой; не подменяем историю временным массивом.
  database ??= openRepository();
  return database;
}

export function saveWorkout(record: WorkoutRecord): void {
  if (!isWorkoutRecord(record)) throw new Error('Invalid completed workout');
  const db = getDatabase();
  const existing = db.select().from(workouts).where(eq(workouts.id, record.id)).get();
  if (existing != null) {
    // Повторное нажатие «Сохранить» безопасно, но чужую запись с тем же id не затираем.
    const persistedFields = ['id', 'mode', 'startedAt', 'endedAt', 'durationMs', 'reps', 'target'] as const;
    if (persistedFields.some(key => existing[key] !== record[key])) {
      throw new Error('Workout identifier conflict');
    }
    return;
  }
  db.insert(workouts).values(record).run();
}

export function listWorkouts(mode: WorkoutRecord['mode'], limit = 100): WorkoutRecord[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid history limit');
  const result = getDatabase().select().from(workouts).where(eq(workouts.mode, mode))
    .orderBy(desc(workouts.endedAt)).limit(limit).all();
  if (!result.every(isWorkoutRecord)) throw new Error('Stored workout is invalid');
  return result;
}

export function deleteWorkout(id: string, mode: WorkoutRecord['mode']): void {
  // Удаление возможно только по явному действию в интерфейсе и в выбранном режиме.
  getDatabase().delete(workouts).where(and(eq(workouts.id, id), eq(workouts.mode, mode))).run();
}
