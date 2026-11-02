import { useEffect, useState } from 'react';
import { loadTensorflowModel, type TfliteModel } from 'react-native-fast-tflite';

import { decodePose } from '../model/decodePose';
import { isMoveNetContract } from './modelContract';

export type MoveNetState =
  | { status: 'loading'; model: undefined }
  | { status: 'ready'; model: TfliteModel }
  | { status: 'error'; model: undefined; message: string };

export function useMoveNetModel(attempt = 0): MoveNetState {
  const [loaded, setLoaded] = useState<{ attempt: number; result: MoveNetState }>({
    attempt, result: { status: 'loading', model: undefined },
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // CPU — воспроизводимая базовая конфигурация. Делегаты сравниваем отдельно.
        const model = await loadTensorflowModel(
          // Metro требует статический require для включения бинарного asset в bundle.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../../../assets/models/movenet-lightning-int8.tflite'), [],
        );
        if (!isMoveNetContract(model)) throw new Error('Unexpected MoveNet tensor contract');
        // Прогрев на чёрном кадре проверяет настоящий TFLite, но не качество позы.
        const outputs = await model.run([new ArrayBuffer(192 * 192 * 3)]);
        if (outputs.length !== 1 || outputs[0].byteLength !== 51 * 4
          || !decodePose(new Float32Array(outputs[0]), new Float32Array(51))) {
          throw new Error('Invalid MoveNet warm-up output');
        }
        if (!cancelled) {
          if (__DEV__) console.info('[MoveNet] uint8 1×192×192×3 → float32 1×1×17×3; warm-up passed');
          setLoaded({ attempt, result: { status: 'ready', model } });
        }
      } catch (error) {
        if (__DEV__) console.warn('[MoveNet] initialization failed:', error);
        if (!cancelled) setLoaded({ attempt, result: { status: 'error', model: undefined,
          message: 'Не удалось подготовить распознавание. Повторите загрузку модели.' } });
      }
    }
    void load();
    // Не публикуем результат загрузки после ухода с экрана. Native-ссылки освобождает GC.
    return () => { cancelled = true; };
  }, [attempt]);
  return loaded.attempt === attempt ? loaded.result : { status: 'loading', model: undefined };
}
