import { Canvas, Path, usePathValue } from '@shopify/react-native-skia';
import { StyleSheet } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import type { PoseSnapshot } from '../inference/usePosePipeline';
import { frameToScreen } from './frameToScreen';

const EDGES = [[0, 1], [0, 2], [1, 3], [2, 4], [5, 6], [5, 7], [7, 9],
  [6, 8], [8, 10], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15],
  [12, 14], [14, 16]] as const;

export function PoseOverlay({ pose, width, height, mirrored }: {
  pose: SharedValue<PoseSnapshot | null>; width: number; height: number; mirrored: boolean;
}) {
  // Переиспользуем native Path; shared value обновляет Skia без React-рендера на кадр.
  const skeleton = usePathValue(path => {
    'worklet';
    const snapshot = pose.get();
    if (snapshot == null || width <= 0 || height <= 0) return;
    const points = snapshot.points;
    for (const [a, b] of EDGES) {
      if (points[a * 3 + 2] < 0.4 || points[b * 3 + 2] < 0.4) continue;
      const start = frameToScreen(points[a * 3], points[a * 3 + 1],
        snapshot.width, snapshot.height, width, height, mirrored);
      const end = frameToScreen(points[b * 3], points[b * 3 + 1],
        snapshot.width, snapshot.height, width, height, mirrored);
      path.moveTo(start.x, start.y);
      path.lineTo(end.x, end.y);
    }
  });
  const joints = usePathValue(path => {
    'worklet';
    const snapshot = pose.get();
    if (snapshot == null || width <= 0 || height <= 0) return;
    for (let index = 0; index < 17; index++) {
      if (snapshot.points[index * 3 + 2] < 0.4) continue;
      const point = frameToScreen(snapshot.points[index * 3], snapshot.points[index * 3 + 1],
        snapshot.width, snapshot.height, width, height, mirrored);
      path.addCircle(point.x, point.y, 4);
    }
  });
  return <Canvas style={StyleSheet.absoluteFill} pointerEvents="none" accessible={false}>
    <Path path={skeleton} color="#69D9CE" style="stroke" strokeWidth={3} strokeCap="round" />
    <Path path={joints} color="#F3F8F7" />
  </Canvas>;
}
