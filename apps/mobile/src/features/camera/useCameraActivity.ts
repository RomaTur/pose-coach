import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { shouldActivateCamera } from './cameraPolicy';

export function useCameraActivity(
  hasPermission: boolean, hasDevice: boolean, isPaused: boolean, hasError: boolean,
) {
  const [appState, setAppState] = useState(AppState.currentState);
  const [isFocused, setFocused] = useState(false);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  return shouldActivateCamera({ hasPermission, hasDevice, isPaused, hasError, appState, isFocused });
}
