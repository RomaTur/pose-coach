export interface CameraConditions {
  hasPermission: boolean;
  hasDevice: boolean;
  isFocused: boolean;
  appState: string | null;
  isPaused: boolean;
  hasError: boolean;
}

export function shouldActivateCamera(conditions: CameraConditions): boolean {
  return conditions.hasPermission && conditions.hasDevice && conditions.isFocused
    && conditions.appState === 'active' && !conditions.isPaused && !conditions.hasError;
}
