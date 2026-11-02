import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText as Text } from './AppText';

export const colors = {
  background: '#101619', surface: '#1C282B', raised: '#273639',
  text: '#F3F8F7', muted: '#A7BBB7', accent: '#69D9CE', onAccent: '#102320', danger: '#FFB4A9',
};

export function Action({ label, onPress, secondary = false, disabled = false, selected = false }: {
  label: string; onPress: () => void; secondary?: boolean; disabled?: boolean; selected?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled, selected }}
    disabled={disabled} onPress={onPress}
    style={({ pressed }) => [ui.action, secondary && ui.secondary, (disabled || pressed) && ui.dimmed]}>
    <Text style={[ui.actionText, secondary && ui.secondaryText]}>{label}</Text>
  </Pressable>;
}

export function Page({ children }: { children: ReactNode }) {
  return <SafeAreaView edges={['bottom', 'left', 'right']} style={ui.screen}>
    <ScrollView contentContainerStyle={ui.content}>{children}</ScrollView>
  </SafeAreaView>;
}

export function formatDuration(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, gap: 24, paddingBottom: 36 },
  heading: { color: colors.text, fontSize: 24, fontWeight: '600' },
  body: { color: colors.text, fontSize: 17, lineHeight: 25 },
  muted: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  error: { color: colors.danger, fontSize: 17, lineHeight: 25 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  section: { gap: 16 },
  action: { backgroundColor: colors.accent, borderRadius: 12, minHeight: 50,
    maxWidth: '100%', paddingHorizontal: 18, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  actionText: { color: colors.onAccent, fontSize: 17, fontWeight: '600' },
  secondary: { backgroundColor: colors.raised },
  secondaryText: { color: colors.text },
  dimmed: { opacity: 0.55 },
});
