import { Switch, View } from 'react-native';

import { Action, colors, Page, ui } from '../../shared/ui/coachUi';
import { AppText as Text } from '../../shared/ui/AppText';
import { useSettingsStore } from './model/settingsStore';

export function SettingsScreen() {
  const { settings, ready, error, change, load } = useSettingsStore();
  return <Page>
    <Text style={ui.muted}>Настройки хранятся только на этом устройстве.</Text>
    <View style={ui.section}>
      <Text accessibilityRole="header" style={ui.heading}>Цель подхода</Text>
      <Text style={ui.body}>{settings.target} повторений</Text>
      <View style={ui.row}>
        <Action label="Уменьшить на 5" secondary disabled={!ready || settings.target <= 5}
          onPress={() => change({ target: Math.max(1, settings.target - 5) })} />
        <Action label="Увеличить на 5" secondary disabled={!ready || settings.target >= 100}
          onPress={() => change({ target: Math.min(100, settings.target + 5) })} />
      </View>
      <Text style={ui.muted}>Применяется к следующему подходу. Достижение цели не завершает его автоматически.</Text>
    </View>
    {([
      ['voice', 'Голосовой счёт', 'Приложение произносит отсчёт и число повторений. На iPhone звук может зависеть от беззвучного режима.'],
      ['haptics', 'Тактильный отклик', 'Короткий отклик при засчитанном повторении.'],
      ['diagnostics', 'Диагностика модели', 'Показывать измеренную частоту обработки и задержку инференса.'],
    ] as const).map(([key, title, description]) => <View key={key} style={ui.section}>
      <View style={[ui.row, { justifyContent: 'space-between' }]}>
        <Text style={[ui.body, { flex: 1 }]}>{title}</Text>
        <Switch accessibilityLabel={title} value={settings[key]} disabled={!ready}
          trackColor={{ true: colors.accent }} onValueChange={value => change({ [key]: value })} />
      </View>
      <Text style={ui.muted}>{description}</Text>
    </View>)}
    {error && <View style={ui.section}>
      <Text accessibilityRole="alert" style={ui.error}>{error}</Text>
      <Action label="Прочитать настройки снова" secondary onPress={load} />
    </View>}
    <Text style={ui.muted}>Pose Coach — экспериментальный счётчик движений, не медицинская оценка техники. Остановитесь при боли или дискомфорте.</Text>
  </Page>;
}
