import { createSquatState, updateSquat, type SquatState } from './squatCounter.ts';

export type WorkoutMode = 'live' | 'demo';
export type WorkoutPhase = 'setup' | 'preparing' | 'countdown' | 'active' | 'paused' | 'finished';

export type WorkoutSession = {
  id: string;
  mode: WorkoutMode;
  target: number;
  phase: WorkoutPhase;
  counter: SquatState;
  startedAt: number | null;
  endedAt: number | null;
  countdownUntil: number | null;
  activeSince: number | null;
  elapsedMs: number;
  lastEventAt: number | null;
  lastPoseAt: number | null;
};

export type WorkoutEvent =
  | { type: 'start' | 'resume' | 'tick' | 'pause' | 'finish'; now: number }
  | { type: 'pose'; now: number; bodyVisible: boolean; angle: number | null };

export function createWorkout(id: string, mode: WorkoutMode, target = 10): WorkoutSession {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new TypeError('Workout id must be a nonempty string');
  }
  if (mode !== 'live' && mode !== 'demo') {
    throw new TypeError('Workout mode must be live or demo');
  }
  if (!Number.isInteger(target) || target < 1 || target > 100) {
    throw new RangeError('Workout target must be an integer from 1 to 100');
  }
  return {
    id, mode, target,
    phase: 'setup',
    counter: createSquatState(),
    startedAt: null,
    endedAt: null,
    countdownUntil: null,
    activeSince: null,
    elapsedMs: 0,
    lastEventAt: null,
    lastPoseAt: null,
  };
}

function isValidTime(now: number): boolean {
  return Number.isFinite(now) && now >= 0;
}

function isPoseFresh(state: WorkoutSession, now: number): boolean {
  return state.lastPoseAt !== null && now - state.lastPoseAt <= 1000;
}

function pauseWorkout(state: WorkoutSession, now: number): WorkoutSession {
  return {
    ...state,
    phase: 'paused',
    counter: { ...createSquatState(), reps: state.counter.reps },
    elapsedMs: elapsedWorkoutMs(state, now),
    activeSince: null,
    countdownUntil: null,
    lastEventAt: now,
  };
}

export function reduceWorkout(state: WorkoutSession, event: WorkoutEvent): WorkoutSession {
  const { now } = event;
  if (state.phase === 'finished' || !isValidTime(now) ||
      (state.lastEventAt !== null && now < state.lastEventAt)) return state;

  switch (event.type) {
    case 'start':
    case 'resume': {
      const requiredPhase = event.type === 'start' ? 'setup' : 'paused';
      if (state.phase !== requiredPhase) return state;
      // Нажатие задаёт намерение; прежняя поза не запускает отсчёт.
      return {
        ...state, phase: 'preparing', countdownUntil: null, activeSince: null,
        counter: { ...createSquatState(), reps: state.counter.reps },
        lastPoseAt: null, lastEventAt: now,
      };
    }
    case 'tick':
      if (state.phase === 'countdown' && !isPoseFresh(state, now)) {
        return { ...state, phase: 'preparing', countdownUntil: null, lastEventAt: now };
      }
      if (state.phase === 'countdown' && state.countdownUntil !== null && now >= state.countdownUntil) {
        // Опоздавший tick не добавляет время, в которое тренировка ещё не была активна.
        return {
          ...state,
          phase: 'active',
          startedAt: state.startedAt ?? now,
          activeSince: now,
          countdownUntil: null,
          lastEventAt: now,
        };
      }
      return { ...state, lastEventAt: now };
    case 'pose':
      if (state.phase === 'preparing' || state.phase === 'countdown') {
        const visible = event.bodyVisible === true;
        // Разрыв проверяем до обновления lastPoseAt, даже если таймер не тикал.
        const restart = state.phase === 'preparing' || !isPoseFresh(state, now);
        return {
          ...state,
          phase: visible ? 'countdown' : 'preparing',
          countdownUntil: visible ? restart ? now + 3000 : state.countdownUntil : null,
          lastPoseAt: now,
          lastEventAt: now,
        };
      }
      return {
        ...state,
        counter: state.phase === 'active'
          ? updateSquat(state.counter, event.bodyVisible ? event.angle : null, now)
          : state.counter,
        lastEventAt: now,
        lastPoseAt: now,
      };
    case 'pause':
      if (state.phase !== 'active' && state.phase !== 'countdown' && state.phase !== 'preparing') return state;
      return pauseWorkout(state, now);
    case 'finish':
      if (state.phase === 'setup') return state;
      return {
        ...state,
        phase: 'finished',
        endedAt: now,
        elapsedMs: elapsedWorkoutMs(state, now),
        activeSince: null,
        countdownUntil: null,
        lastEventAt: now,
      };
    default:
      return state;
  }
}

export function elapsedWorkoutMs(state: WorkoutSession, now: number): number {
  if (state.phase !== 'active' || state.activeSince === null || !isValidTime(now)) return state.elapsedMs;
  const activeMs = Math.max(0, now - state.activeSince);
  // Даже при предельных числах селектор не должен отдавать бесконечную длительность.
  return Math.min(Number.MAX_VALUE, state.elapsedMs + activeMs);
}

export function countdownSeconds(state: WorkoutSession, now: number): number {
  if (state.phase !== 'countdown' || state.countdownUntil === null || !isValidTime(now)) return 0;
  return Math.max(0, Math.ceil((state.countdownUntil - now) / 1000));
}
