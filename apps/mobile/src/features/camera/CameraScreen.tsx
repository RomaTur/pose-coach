import { useCallback, useEffect, useState } from 'react';
import { Linking, ScrollView, StatusBar, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCameraDevice, useCameraPermission } from 'react-native-vision-camera';

import { EMPTY_POSE_SUMMARY } from '../pose/inference/usePosePipeline';
import { useMoveNetModel } from '../pose/inference/useMoveNetModel';
import { Action } from '../../shared/ui/coachUi';
import { AppText as Text } from '../../shared/ui/AppText';
import { WorkoutPanel } from '../coach/WorkoutPanel';
import { coachStore, useCoachStore } from '../coach/model/coachStore';
import { DemoPreview } from '../demo/DemoPreview';
import { useSettingsStore } from '../settings/model/settingsStore';
import { PoseCameraPreview } from './PoseCameraPreview';
import { useCameraActivity } from './useCameraActivity';

function acceptLiveSample(angle: number | null, bodyVisible: boolean) {
  const state = coachStore.getState();
  if (state.session.mode === 'live') state.dispatch({ type: 'pose', angle, bodyVisible });
}

export function CameraScreen() {
  const { width, height } = useWindowDimensions();
  const previewMinHeight = Math.max(220, Math.min(width - 32, height * 0.4));
  const { hasPermission, canRequestPermission, requestPermission } = useCameraPermission();
  const [position, setPosition] = useState<'front' | 'back'>('front');
  const device = useCameraDevice(position);
  const alternativeDevice = useCameraDevice(position === 'front' ? 'back' : 'front');
  const [isPaused, setPaused] = useState(false);
  const [isRequesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const modelState = useMoveNetModel(attempt);
  const [summary, setSummary] = useState(EMPTY_POSE_SUMMARY);
  const mode = useCoachStore(state => state.session.mode);
  const phase = useCoachStore(state => state.session.phase);
  const startedAt = useCoachStore(state => state.session.startedAt);
  const saveStatus = useCoachStore(state => state.saveStatus);
  const settings = useSettingsStore(state => state.settings);
  const isDemo = mode === 'demo';
  const isActive = useCameraActivity(isDemo || hasPermission, isDemo || device != null,
    isPaused || phase === 'finished', !isDemo && error !== null);
  useEffect(() => {
    if (!isActive) coachStore.getState().dispatch({ type: 'pause' });
  }, [isActive]);
  useFocusEffect(useCallback(() => () => { coachStore.getState().dispatch({ type: 'pause' }); }, []));
  const onCameraError = useCallback((_error: Error) => {
    setError('Не удалось запустить камеру. Закройте другие приложения с камерой и повторите попытку.');
  }, []);

  const allowCamera = async () => {
    if (isRequesting) return;
    setRequesting(true);
    setError(null);
    try {
      if (canRequestPermission) await requestPermission();
      else await Linking.openSettings();
    } catch {
      setError('Не удалось открыть разрешения. Попробуйте снова или откройте настройки приложения.');
    } finally { setRequesting(false); }
  };
  const retry = () => { setError(null); setAttempt(value => value + 1); };
  const switchCamera = () => {
    coachStore.getState().dispatch({ type: 'pause' });
    setError(null);
    setPosition(value => value === 'front' ? 'back' : 'front');
  };
  const hasPreview = hasPermission && device != null;
  const canSwitchMode = phase === 'setup' || (phase === 'finished' &&
    (startedAt === null || saveStatus === 'saved' || saveStatus === 'discarded'));
  const modeHint = canSwitchMode ? null : phase !== 'finished'
    ? 'Чтобы сменить режим, сначала завершите подход.'
    : saveStatus === 'error'
      ? 'Сначала выберите «Повторить сохранение» или «Продолжить без сохранения» внизу экрана.'
      : 'Результат сохраняется. Дождитесь завершения сохранения.';
  const switchMode = () => {
    if (coachStore.getState().newSession(isDemo ? 'live' : 'demo', settings.target)) {
      setPaused(false); setError(null);
    }
  };

  return (
    <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={styles.screen}>
      <StatusBar barStyle="light-content" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>Pose Coach</Text>
          <Text style={styles.subtitle}>{isDemo ? 'Демонстрация без камеры' : 'Движение в фокусе.'}</Text>
          <View style={styles.controls}>
            <Action label="История" secondary onPress={() => router.push('/history')} />
            <Action label="Настройки" secondary onPress={() => router.push('/settings')} />
          </View>
        </View>
        <View style={[styles.viewport, { minHeight: previewMinHeight }]}>
          {isDemo ? <DemoPreview isActive={isActive} viewportHeight={previewMinHeight} /> : hasPreview && !error ? (
            <PoseCameraPreview key={`${position}-${attempt}`} device={device}
              isActive={isActive} model={modelState.model} onError={onCameraError}
              onPipelineError={setError} onSummary={setSummary} onSample={acceptLiveSample} />
          ) : (
            <View style={styles.emptyState}>
              <Text accessibilityRole="header" style={styles.messageTitle}>
                {error ? 'Камера недоступна' : !hasPermission
                  ? 'Начнём с камеры' : 'Нужна камера устройства'}
              </Text>
              <Text style={styles.message}>
                {error ?? (!hasPermission
                  ? 'Разрешите доступ, чтобы видеть положение тела. Обработка будет на устройстве — видео не записывается и не отправляется.'
                  : 'Эта камера недоступна. Для живого распознавания откройте приложение на iPhone. В симуляторе камеры может не быть.')}
              </Text>
              {!hasPermission ? (
                <Action label={isRequesting ? 'Открываем…' : canRequestPermission
                  ? 'Разрешить камеру' : 'Открыть настройки'} onPress={allowCamera} disabled={isRequesting} />
              ) : error ? <Action label="Повторить попытку" onPress={retry} />
                : alternativeDevice != null ? <Action label="Использовать другую камеру" onPress={switchCamera} />
                  : null}
            </View>
          )}
        </View>
        <View style={styles.footer}>
          {(isDemo || hasPreview) && phase !== 'finished' && <Text style={styles.hint}>{isDemo
            ? 'Это синтетический пример. Он проверяет счётчик и интерфейс, но не качество распознавания.'
            : !isActive ? 'Камера остановлена.' : phase === 'preparing'
              ? 'Ждём тело в кадре. Отсчёт начнётся автоматически.' : phase === 'active'
                ? summary.bodyVisible ? 'Держите плечи и стопы в кадре.' : 'Тело не видно. Вернитесь в кадр, чтобы продолжить подсчёт.'
                : phase === 'countdown' ? 'Оставайтесь в кадре до окончания отсчёта.'
                  : phase === 'paused' ? 'Нажмите «Продолжить подход», затем отойдите в кадр.'
                    : 'Поставьте телефон устойчиво. Нажмите «Начать подход», затем отойдите в кадр.'}</Text>}
          {!isDemo && hasPreview && phase !== 'finished' && (
            <View style={styles.controls}>
              <Action label={isPaused ? 'Включить камеру' : 'Выключить камеру'} secondary onPress={() => {
                coachStore.getState().dispatch({ type: 'pause' });
                setPaused(value => !value);
              }} />
              <Action label="Сменить камеру" onPress={switchCamera} secondary disabled={alternativeDevice == null} />
            </View>
          )}
          {!isDemo && <Text style={styles.stageNote} accessibilityLiveRegion="polite">
            {modelState.status === 'loading' ? 'Подготавливаем MoveNet на устройстве…'
              : modelState.status === 'error' ? modelState.message
                : 'MoveNet готов · обработка на устройстве · видео не сохраняется'}
          </Text>}
          {!isDemo && modelState.status === 'error' && <Action label="Повторить загрузку модели" onPress={retry} />}
          {!isDemo && settings.diagnostics && isActive && summary.avgMs != null && <Text style={styles.stageNote}>
            {summary.modelFps == null ? 'Собираем метрики' : `${summary.modelFps.toFixed(1)} кадров/с модели`}
            {` · инференс ${summary.avgMs.toFixed(1)} мс · p95 ${summary.p95Ms?.toFixed(1)} мс`}
          </Text>}
          <Action secondary disabled={!canSwitchMode}
            label={isDemo ? 'Вернуться к камере' : 'Посмотреть демонстрацию'} onPress={switchMode} />
          {modeHint && <Text style={styles.stageNote} accessibilityLiveRegion="polite">{modeHint}</Text>}
        </View>
      </ScrollView>
      {/* Единственная панель остаётся вне длинного содержимого и не перекрывает видео. */}
      {(isDemo || hasPreview || phase !== 'setup') && <ScrollView style={styles.workoutDock}
        contentContainerStyle={styles.workoutContent}>
        <WorkoutPanel ready={isActive && (isDemo || modelState.status === 'ready')} />
      </ScrollView>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#101619' },
  scroll: { flex: 1, minHeight: 0 },
  workoutDock: { flexGrow: 0, flexShrink: 1, maxHeight: '50%', backgroundColor: '#1C282B' },
  workoutContent: { padding: 16 },
  content: { flexGrow: 1 },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24, gap: 6 },
  title: { color: '#F3F8F7', fontSize: 34, fontWeight: '700', letterSpacing: -0.7 },
  subtitle: { color: '#A7BBB7', fontSize: 17 },
  viewport: { flexGrow: 1, flexShrink: 0, backgroundColor: '#1C282B', marginHorizontal: 16, borderRadius: 16, overflow: 'hidden' },
  emptyState: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 20 },
  messageTitle: { color: '#F3F8F7', fontSize: 28, fontWeight: '600' },
  message: { color: '#C6D4D1', fontSize: 17, lineHeight: 25 },
  footer: { padding: 24, gap: 16 },
  hint: { color: '#F3F8F7', fontSize: 17, lineHeight: 24 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  stageNote: { color: '#A7BBB7', fontSize: 13, lineHeight: 19 },
});
