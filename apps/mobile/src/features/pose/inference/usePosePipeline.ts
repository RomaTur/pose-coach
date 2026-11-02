import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TfliteModel } from 'react-native-fast-tflite';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { useFrameOutput } from 'react-native-vision-camera';
import { useResizer } from 'react-native-vision-camera-resizer';
import { createShareable, scheduleOnRN, scheduleOnRuntimeWithId, scheduleOnUI, UIRuntimeId } from 'react-native-worklets';

import { createFrameMetrics, recordFrame, summarizeFrames } from '../../metrics/frameMetrics';
import { decodePose } from '../model/decodePose';
import { getKneeAngle, isBodyVisible, unletterboxPose } from '../model/poseGeometry';

export interface PoseSnapshot {
  points: Float32Array;
  width: number;
  height: number;
  timestampMs: number;
  receivedAt: number;
}

export interface PoseSummary {
  angle: number | null;
  bodyVisible: boolean;
  modelFps: number | null;
  avgMs: number | null;
  p95Ms: number | null;
}

export const EMPTY_POSE_SUMMARY: PoseSummary = {
  angle: null, bodyVisible: false, modelFps: null, avgMs: null, p95Ms: null,
};

export function usePosePipeline(model: TfliteModel | undefined, isActive: boolean,
  onSummary: (summary: PoseSummary) => void,
  onSample: (angle: number | null, bodyVisible: boolean) => void) {
  const resizeState = useResizer({ width: 192, height: 192, channelOrder: 'rgb',
    dataType: 'uint8', pixelLayout: 'interleaved', scaleMode: 'contain' });
  const resizer = resizeState.resizer;
  const pose = useSharedValue<PoseSnapshot | null>(null);
  const metrics = useSharedValue(() => createFrameMetrics());
  const enabled = useSharedValue(false);
  const epoch = useSharedValue(0);
  const lastFrameAt = useSharedValue(0);
  const lastSummaryAt = useSharedValue(0);
  const failed = useSharedValue(false);
  const epochRef = useRef(0);
  const [processingError, setProcessingError] = useState<string | null>(null);

  const publishSummary = useCallback((value: PoseSummary, generation: number) => {
    if (generation !== epochRef.current) return;
    onSummary(value);
    if (value.angle === null && !value.bodyVisible) onSample(null, false);
  }, [onSummary, onSample]);
  const publishSample = useCallback((angle: number | null, bodyVisible: boolean,
    receivedAt: number, generation: number) => {
    if (generation !== epochRef.current) return;
    // Очередь JS не должна проигрывать старые позы как новые после долгой блокировки.
    if (Date.now() - receivedAt > 400) onSample(null, false);
    else onSample(angle, bodyVisible);
  }, [onSample]);
  const publishFailure = useCallback((generation: number, reason: string) => {
    if (generation === epochRef.current) {
      if (__DEV__) console.warn('[MoveNet] frame processing failed:', reason);
      setProcessingError('Распознавание остановилось. Повторите запуск камеры.');
      onSummary(EMPTY_POSE_SUMMARY);
      onSample(null, false);
    }
  }, [onSummary, onSample]);

  const reset = useCallback((active: boolean, generation: number) => {
    'worklet';
    enabled.set(active);
    epoch.set(generation);
    pose.set(null);
    metrics.set(createFrameMetrics());
    lastFrameAt.set(0);
    lastSummaryAt.set(0);
    failed.set(false);
    scheduleOnRN(publishSummary, EMPTY_POSE_SUMMARY, generation);
  }, [enabled, epoch, pose, metrics, lastFrameAt, lastSummaryAt, failed, publishSummary]);

  useEffect(() => {
    const generation = ++epochRef.current;
    scheduleOnUI(reset, isActive && model != null, generation);
    return () => {
      epochRef.current = generation + 1;
      scheduleOnUI(reset, false, generation + 1);
    };
  }, [isActive, model, reset]);

  // Кольцо метрик и оверлей принадлежат UI runtime, а не React-рендеру.
  const commitPose = useCallback((snapshot: PoseSnapshot, inferenceMs: number, generation: number) => {
    'worklet';
    if (!enabled.get() || epoch.get() !== generation) return;
    pose.set(snapshot);
    metrics.modify(value => {
      'worklet';
      recordFrame(value, snapshot.timestampMs, inferenceMs);
      return value;
    });
    const angle = getKneeAngle(snapshot.points, snapshot.width, snapshot.height);
    const bodyVisible = isBodyVisible(snapshot.points);
    // Для счётчика — только два скаляра на обработанную позу. HUD остаётся 4 Гц.
    scheduleOnRN(publishSample, angle, bodyVisible, snapshot.receivedAt, generation);
    if (snapshot.receivedAt - lastSummaryAt.get() >= 250) {
      const statistics = summarizeFrames(metrics.get());
      scheduleOnRN(publishSummary, {
        angle, bodyVisible,
        modelFps: statistics.fps, avgMs: statistics.avgMs, p95Ms: statistics.p95Ms,
      }, generation);
      lastSummaryAt.set(snapshot.receivedAt);
    }
  }, [enabled, epoch, pose, metrics, lastSummaryAt, publishSummary, publishSample]);

  const commitFailure = useCallback((generation: number, reason: string) => {
    'worklet';
    if (!enabled.get() || epoch.get() !== generation) return;
    failed.set(true);
    pose.set(null);
    scheduleOnRN(publishFailure, generation, reason);
  }, [enabled, epoch, failed, pose, publishFailure]);

  // Callback распаковывается только на UI: после unpack его нельзя пересылать как worklet.
  // eslint-disable-next-line react-hooks/refs -- createShareable сериализует callbacks, но не вызывает их и не читает epochRef.
  const uiCommits = useMemo(() => createShareable(UIRuntimeId, { commitPose, commitFailure }),
    [commitPose, commitFailure]);

  // При остановившемся потоке не оставляем старый скелет и устаревшие подсказки.
  useFrameCallback(() => {
    'worklet';
    const currentPose = pose.get();
    if (currentPose != null && Date.now() - currentPose.receivedAt > 400) {
      pose.set(null);
      metrics.set(createFrameMetrics());
      scheduleOnRN(publishSummary, EMPTY_POSE_SUMMARY, epoch.get());
    }
  });

  const output = useFrameOutput({
    pixelFormat: 'yuv', targetResolution: { width: 640, height: 480 },
    enablePhysicalBufferRotation: false, dropFramesWhileBusy: true,
    onFrame(frame) {
      'worklet';
      let generation = 0;
      try {
        generation = epoch.get();
        if (!enabled.get() || failed.get() || model == null || resizer == null) return;
        const now = performance.now();
        // Ограничиваем работу модели, а не частоту preview. Фактический FPS измеряется.
        const previousFrameAt = lastFrameAt.get();
        if (previousFrameAt !== 0 && now - previousFrameAt < 1000 / 15) return;
        lastFrameAt.set(now);
        const resized = resizer.resize(frame);
        try {
          // Буфер принадлежит GPUFrame и действителен до finally/dispose.
          const input = resized.getPixelBuffer();
          if (input.byteLength !== 192 * 192 * 3) throw new Error('Invalid RGB buffer');
          const startedAt = performance.now();
          const outputs = model.runSync([input]);
          const inferenceMs = performance.now() - startedAt;
          if (outputs.length !== 1 || outputs[0].byteLength !== 51 * 4) throw new Error('Invalid output');
          // Копия 204 байт отделяет опубликованную позу от следующего native runSync.
          const points = new Float32Array(new Float32Array(outputs[0]));
          const rotated = frame.orientation === 'left' || frame.orientation === 'right';
          const width = rotated ? frame.height : frame.width;
          const height = rotated ? frame.width : frame.height;
          if (!decodePose(points, points) || !unletterboxPose(points, width, height)) {
            throw new Error('Invalid pose');
          }
          // Новая worklet захватывает Shareable-ссылку, а не уже распакованный callback.
          scheduleOnRuntimeWithId(UIRuntimeId, (snapshot: PoseSnapshot, elapsedMs: number, frameEpoch: number) => {
            'worklet';
            if (uiCommits.isHost) uiCommits.value.commitPose(snapshot, elapsedMs, frameEpoch);
          }, { points, width, height, timestampMs: now, receivedAt: Date.now() }, inferenceMs, generation);
        } finally { resized.dispose(); }
      } catch (error) {
        // Ошибка старого кадра не должна останавливать новую активную сессию.
        scheduleOnRuntimeWithId(UIRuntimeId, (frameEpoch: number, reason: string) => {
          'worklet';
          if (uiCommits.isHost) uiCommits.value.commitFailure(frameEpoch, reason);
        }, generation, error instanceof Error ? error.message : 'Unknown frame error');
      } finally { frame.dispose(); }
    },
  });

  return { output, pose, error: processingError ?? (resizeState.state === 'error'
    ? 'GPU-обработка недоступна на этом устройстве.' : null),
  isReady: model != null && resizeState.state === 'ready' };
}
