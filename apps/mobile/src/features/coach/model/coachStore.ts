import { randomUUID } from 'expo-crypto';
import { useStore } from 'zustand';

import { saveWorkout } from '../../../entities/workout/api/workoutRepository';
import { createCoachStore, type CoachState } from './createCoachStore';

// Все события используют одни часы JS-потока. Буферы камеры в store не попадают.
export const coachStore = createCoachStore({ now: Date.now, id: randomUUID, save: saveWorkout });

export function useCoachStore<T>(selector: (state: CoachState) => T): T {
  return useStore(coachStore, selector);
}
