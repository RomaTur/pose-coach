export type SquatState = {
  phase: 'ready' | 'down';
  reps: number;
  armed: boolean;
  holdStartedAtMs: number | null;
  lastTimestampMs: number | null;
};

export function createSquatState(): SquatState {
  'worklet';

  return {
    phase: 'ready',
    reps: 0,
    armed: false,
    holdStartedAtMs: null,
    lastTimestampMs: null,
  };
}

export function updateSquat(
  state: SquatState,
  angle: number | null,
  timestampMs: number,
): SquatState {
  'worklet';

  const validTimestamp = Number.isFinite(timestampMs) && timestampMs >= 0;
  if (!validTimestamp || angle === null || !Number.isFinite(angle) || angle < 0 || angle > 180 ||
      (state.lastTimestampMs !== null && timestampMs <= state.lastTimestampMs)) {
    return {
      ...createSquatState(),
      reps: state.reps,
      lastTimestampMs: validTimestamp ? timestampMs : null,
    };
  }

  const next = { ...state, lastTimestampMs: timestampMs };
  if (state.lastTimestampMs !== null && timestampMs - state.lastTimestampMs > 1000) {
    next.phase = 'ready';
    next.armed = false;
    next.holdStartedAtMs = null;
  }

  const expectsStanding = !next.armed || next.phase === 'down';
  const matches = expectsStanding ? angle >= 160 : angle <= 100;
  if (!matches) {
    next.holdStartedAtMs = null;
    return next;
  }
  if (next.holdStartedAtMs === null) {
    next.holdStartedAtMs = timestampMs;
    return next;
  }
  if (timestampMs - next.holdStartedAtMs < 200) return next;

  next.holdStartedAtMs = null;
  if (!next.armed) {
    // Начальная стойка обязательна: появление в кадре внизу не считается приседом.
    next.armed = true;
  } else if (next.phase === 'ready') {
    next.phase = 'down';
  } else {
    next.phase = 'ready';
    next.reps += 1;
  }
  return next;
}
