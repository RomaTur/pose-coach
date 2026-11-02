import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';

import { Action, colors, formatDuration, ui } from '../../shared/ui/coachUi';
import { AppText as Text } from '../../shared/ui/AppText';
import { useSettingsStore } from '../settings/model/settingsStore';
import { coachStore, useCoachStore } from './model/coachStore';
import { countdownSeconds, elapsedWorkoutMs } from './model/workoutSession';

export function WorkoutPanel({ ready }: { ready: boolean }) {
  const phase = useCoachStore(state => state.session.phase);
  const reps = useCoachStore(state => state.session.counter.reps);
  const target = useCoachStore(state => state.session.target);
  const mode = useCoachStore(state => state.session.mode);
  const saveStatus = useCoachStore(state => state.saveStatus);
  const error = useCoachStore(state => state.error);
  const { voice, haptics, target: nextTarget } = useSettingsStore(state => state.settings);
  const [now, setNow] = useState(Date.now);
  const lastReps = useRef(reps);
  const session = coachStore.getState().session;
  const clockNow = Math.max(now, session.lastEventAt ?? now);
  const countdown = countdownSeconds(session, clockNow);
  const elapsed = elapsedWorkoutMs(session, clockNow);
  const inProgress = phase !== 'setup' && phase !== 'finished';
  const saving = phase === 'finished' && session.startedAt !== null && saveStatus === 'idle';

  useEffect(() => {
    if (phase !== 'active' && phase !== 'countdown' && phase !== 'preparing') return;
    const timer = setInterval(() => {
      coachStore.getState().dispatch({ type: 'tick' });
      setNow(Date.now());
    }, 250);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') coachStore.getState().dispatch({ type: 'pause' });
    });
    return () => { subscription.remove(); void Speech.stop(); };
  }, []);

  useEffect(() => {
    if (reps > lastReps.current && haptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    lastReps.current = reps;
  }, [haptics, reps]);

  useEffect(() => {
    void Speech.stop();
    if (!voice) return;
    if (phase === 'countdown' && countdown > 0) Speech.speak(String(countdown), { language: 'ru-RU' });
    else if (phase === 'active') Speech.speak(reps === 0 ? 'Начинайте' : String(reps), { language: 'ru-RU' });
    return () => { void Speech.stop(); };
  }, [countdown, phase, reps, voice]);

  const dispatch = coachStore.getState().dispatch;
  const next = () => { coachStore.getState().newSession(mode, nextTarget); };
  const discard = () => Alert.alert('Не сохранять результат?', 'Несохранённый результат этого подхода будет потерян.', [
    { text: 'Отмена', style: 'cancel' },
    { text: 'Не сохранять', style: 'destructive', onPress: () => { coachStore.getState().discard(); next(); } },
  ]);

  return <View style={[ui.section, inProgress && styles.compactPanel]}>
    <View style={[ui.row, { justifyContent: 'space-between' }]}>
      <Text accessibilityRole="header" style={[ui.heading, inProgress && styles.compactHeading]}>{phase === 'finished' ? 'Подход завершён' : 'Приседания'}</Text>
      <Text style={ui.muted}>{mode === 'demo' ? 'ДЕМО · ' : ''}Цель {phase === 'setup' ? nextTarget : target}</Text>
    </View>
    {phase === 'setup' ? <Text style={ui.body}>Нажмите «Начать подход» и отойдите от телефона. Когда плечи и ноги будут в кадре, начнётся отсчёт 3 секунды.</Text>
      : phase === 'preparing' ? <View style={ui.section}>
        <Text style={ui.body}>Ожидаем тело в кадре.</Text>
        {session.startedAt !== null && <Text style={ui.muted}>Счёт сохранён: {reps} повторений · {formatDuration(elapsed)}</Text>}
      </View>
      : <View style={styles.scoreRow}>
        <Text accessibilityLabel={phase === 'countdown' ? `До начала ${countdown}` : `${reps} повторений`}
          style={[styles.score, inProgress && styles.compactScore]}>{phase === 'countdown' ? countdown : reps}</Text>
        <View style={styles.scoreCaption}>
          <Text style={ui.body}>{phase === 'countdown' ? 'Приготовьтесь' : 'повторений'}</Text>
          <Text style={ui.muted}>{phase === 'paused' ? 'На паузе · ' : ''}{formatDuration(elapsed)}</Text>
        </View>
      </View>}
    <View style={styles.actions}>
      {phase === 'setup' && <View style={styles.action}><Action label="Начать подход" disabled={!ready}
        onPress={() => {
          if (target !== nextTarget) coachStore.getState().newSession(mode, nextTarget);
          dispatch({ type: 'start' });
        }} /></View>}
      {phase === 'paused' && <View style={styles.action}><Action label="Продолжить подход" disabled={!ready}
        onPress={() => dispatch({ type: 'resume' })} /></View>}
      {(phase === 'active' || phase === 'countdown' || phase === 'preparing') && <View style={styles.action}>
        <Action label="Приостановить подход" onPress={() => dispatch({ type: 'pause' })} /></View>}
      {inProgress && <View style={styles.action}><Action label="Завершить подход" secondary
        onPress={() => dispatch({ type: 'finish' })} /></View>}
    </View>
    {phase === 'preparing' && <Text style={ui.body}>Отойдите от телефона и встаньте боком: покажите плечи, таз, колени и стопы. Дождитесь отсчёта — затем начинайте.</Text>}
    {phase === 'active' && reps >= target && <Text style={ui.body}>Цель достигнута. Можно завершить подход.</Text>}
    {phase === 'finished' && <>
      <Text style={ui.muted}>{saveStatus === 'saved' ? mode === 'demo' ? 'Сохранено в демонстрациях, отдельно от тренировок.' : 'Сохранено в истории на устройстве.'
        : session.startedAt === null ? 'Подготовка отменена. Тренировка не записана.' : 'Результат ещё не сохранён.'}</Text>
      {error ? <>
        <Text accessibilityRole="alert" style={ui.error}>{error}</Text>
        <Action label="Повторить сохранение" onPress={coachStore.getState().save} />
        <Action label="Продолжить без сохранения" secondary onPress={discard} />
      </> : saving ? <Action label="Сохраняем результат…" disabled onPress={() => {}} />
        : <Action label="Новый подход" onPress={next} />}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  compactPanel: { gap: 12 },
  compactHeading: { fontSize: 18 },
  compactScore: { fontSize: 40, letterSpacing: -0.7 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  action: { flexGrow: 1, flexBasis: 132, maxWidth: '100%' },
  scoreRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, alignItems: 'center' },
  score: { fontSize: 88, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'], letterSpacing: -2 },
  scoreCaption: { gap: 6 },
});
