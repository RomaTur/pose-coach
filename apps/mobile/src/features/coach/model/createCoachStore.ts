import { createStore } from 'zustand/vanilla';

import type { WorkoutRecord } from '../../../entities/workout/model/workoutRecord.ts';
import { createWorkout, reduceWorkout, type WorkoutEvent, type WorkoutMode, type WorkoutSession } from './workoutSession.ts';

export type WorkoutAction = WorkoutEvent extends infer Event
  ? Event extends WorkoutEvent ? Omit<Event, 'now'> : never : never;

export interface CoachDependencies {
  now: () => number;
  id: () => string;
  save: (record: WorkoutRecord) => void;
}

export interface CoachState {
  session: WorkoutSession;
  saveStatus: 'idle' | 'saved' | 'error' | 'discarded';
  error: string | null;
  dispatch: (event: WorkoutAction) => void;
  save: () => void;
  discard: () => void;
  newSession: (mode: WorkoutMode, target: number) => boolean;
}

export function createCoachStore(deps: CoachDependencies) {
  return createStore<CoachState>((set, get) => ({
    session: createWorkout(deps.id(), 'live'), saveStatus: 'idle', error: null,
    dispatch: action => {
      const before = get().session;
      const session = reduceWorkout(before, { ...action, now: deps.now() });
      if (session === before) return;
      set({ session });
      if (session.phase === 'finished' && before.phase !== 'finished') get().save();
    },
    save: () => {
      const { session, saveStatus } = get();
      if (session.phase !== 'finished' || session.startedAt === null || session.endedAt === null ||
          saveStatus === 'saved' || saveStatus === 'discarded') return;
      try {
        deps.save({ id: session.id, mode: session.mode, startedAt: session.startedAt,
          endedAt: session.endedAt, durationMs: Math.floor(session.elapsedMs),
          reps: session.counter.reps, target: session.target });
        set({ saveStatus: 'saved', error: null });
      } catch {
        // Результат остаётся в памяти и доступен для повторной записи с тем же id.
        set({ saveStatus: 'error', error: 'Результат пока не сохранён. Освободите место и повторите запись.' });
      }
    },
    discard: () => {
      if (get().session.phase === 'finished') set({ saveStatus: 'discarded', error: null });
    },
    newSession: (mode, target) => {
      const { session, saveStatus } = get();
      if (session.phase !== 'setup' && session.phase !== 'finished') return false;
      if (session.phase === 'finished' && session.startedAt !== null &&
          saveStatus !== 'saved' && saveStatus !== 'discarded') return false;
      set({ session: createWorkout(deps.id(), mode, target), saveStatus: 'idle', error: null });
      return true;
    },
  }));
}
