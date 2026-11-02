import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Alert, View } from 'react-native';

import { deleteWorkout, listWorkouts } from '../../entities/workout/api/workoutRepository';
import type { WorkoutRecord } from '../../entities/workout/model/workoutRecord';
import { Action, formatDuration, Page, ui } from '../../shared/ui/coachUi';
import { AppText as Text } from '../../shared/ui/AppText';

export function HistoryScreen() {
  const [mode, setMode] = useState<'live' | 'demo'>('live');
  const [records, setRecords] = useState<WorkoutRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    try { setRecords(listWorkouts(mode)); setError(null); }
    catch { setError('Не удалось прочитать историю. Данные не удалены — попробуйте ещё раз.'); setRecords([]); }
  }, [mode]);
  useFocusEffect(refresh);

  const remove = (record: WorkoutRecord) => Alert.alert('Удалить подход?',
    'Эта запись будет удалена с устройства. Отменить удаление нельзя.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => {
        try { deleteWorkout(record.id, record.mode); refresh(); }
        catch { setError('Не удалось удалить запись. Попробуйте ещё раз.'); }
      } },
    ]);
  return <Page>
    <View style={ui.row}>
      <Action label="Тренировки" selected={mode === 'live'} secondary={mode !== 'live'} onPress={() => setMode('live')} />
      <Action label="Демонстрации" selected={mode === 'demo'} secondary={mode !== 'demo'} onPress={() => setMode('demo')} />
    </View>
    <Text style={ui.muted}>{mode === 'live' ? 'Последние 100 подходов на этом устройстве.'
      : 'Синтетические подходы для проверки интерфейса. Это не ваши тренировки и не замеры модели.'}</Text>
    {error ? <View style={ui.section}>
      <Text accessibilityRole="alert" style={ui.error}>{error}</Text>
      <Action label="Повторить" onPress={refresh} />
    </View> : records.length === 0 ? <View style={ui.section}>
      <Text accessibilityRole="header" style={ui.heading}>Здесь появятся ваши подходы</Text>
      <Text style={ui.body}>{mode === 'live' ? 'Завершите первый подход на экране камеры — результат сохранится автоматически.'
        : 'Завершите демонстрационный подход, чтобы проверить сохранение результата.'}</Text>
    </View> : records.map(record => <View key={record.id} style={[ui.section, { paddingVertical: 12 }]}>
      <Text accessibilityRole="header" style={ui.heading}>{record.reps} повторений · {formatDuration(record.durationMs)}</Text>
      <Text style={ui.muted}>{new Date(record.endedAt).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })}
        {` · цель ${record.target}${record.mode === 'demo' ? ' · ДЕМО' : ''}`}</Text>
      <Action label="Удалить запись" secondary onPress={() => remove(record)} />
    </View>)}
  </Page>;
}
