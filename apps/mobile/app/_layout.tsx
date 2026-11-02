import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { useSettingsStore } from '../src/features/settings/model/settingsStore';
import { colors } from '../src/shared/ui/coachUi';

// Маршруты отвечают только за навигацию; логика остаётся внутри фич.
export default function RootLayout() {
  useEffect(() => { useSettingsStore.getState().load(); }, []);
  return <Stack screenOptions={{ headerStyle: { backgroundColor: colors.background },
    headerTintColor: colors.text, contentStyle: { backgroundColor: colors.background }, headerBackTitle: 'Назад' }}>
    <Stack.Screen name="index" options={{ headerShown: false }} />
    <Stack.Screen name="history" options={{ title: 'История' }} />
    <Stack.Screen name="settings" options={{ title: 'Настройки' }} />
  </Stack>;
}
