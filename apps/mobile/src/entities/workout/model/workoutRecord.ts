export interface WorkoutRecord {
  id: string;
  mode: 'live' | 'demo';
  startedAt: number;
  endedAt: number;
  durationMs: number;
  reps: number;
  target: number;
}

export function isWorkoutRecord(value: unknown): value is WorkoutRecord {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || row.id.trim().length === 0 || row.id.length > 128
    || (row.mode !== 'live' && row.mode !== 'demo')) return false;
  for (const field of ['startedAt', 'endedAt', 'durationMs', 'reps', 'target']) {
    if (typeof row[field] !== 'number' || !Number.isSafeInteger(row[field]) || row[field] < 0) return false;
  }
  const record = value as WorkoutRecord;
  return record.target >= 1 && record.target <= 100 && record.endedAt >= record.startedAt
    && record.durationMs <= record.endedAt - record.startedAt;
}
